package com.attenda.tracker.local;

import android.content.Intent;
import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.database.Cursor;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.fragment.app.FragmentActivity;
import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.util.Arrays;
import android.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import org.json.JSONObject;

@CapacitorPlugin(name = "LocalAttendance", permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class LocalAttendancePlugin extends Plugin {
    private final ExecutorService databaseExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "attendance-room"); thread.setDaemon(true); return thread;
    });
    private LocalAttendanceRepository repository;

    @Override public void load() {
        super.load();
        repository = new LocalAttendanceRepository(getContext());
        LocalScheduler.ensurePeriodic(getContext());
        databaseExecutor.execute(() -> {
            try {
                repository.runSchedulerTick();
                LocalScheduler.refreshClassEndCheck(getContext(), repository);
            } catch (Exception ignored) { /* surfaced through scheduler status */ }
            try { LocalNotificationScheduler.sync(getContext(), repository); } catch (Exception ignored) { /* retried on next app start or schedule change */ }
        });
    }

    @PluginMethod public void request(PluginCall call) {
        String action = call.getString("action");
        JSONObject payload = call.getObject("payload", new JSObject());
        if (action == null || action.trim().isEmpty()) { call.reject("Local operation is missing.", "invalid_operation"); return; }
        databaseExecutor.execute(() -> {
            try {
                JSONObject result = repository.execute(action, payload);
                if ("scheduler.update".equals(action)) {
                    if (payload.optBoolean("enabled", false)) LocalScheduler.enable(getContext()); else LocalScheduler.disable(getContext());
                }
                // A daily WorkManager run can happen before the user edits today's timetable.
                // Reconcile the current day immediately after schedule-affecting changes so new
                // classes become Pending without requiring an off/on toggle or an app restart.
                if (shouldReconcileScheduler(action)) {
                    try {
                        repository.runSchedulerTick();
                        LocalScheduler.refreshClassEndCheck(getContext(), repository);
                    } catch (Exception ignored) { /* surfaced in scheduler status */ }
                }
                if (affectsNotifications(action)) {
                    try { LocalNotificationScheduler.sync(getContext(), repository); } catch (Exception ignored) { /* data remains saved; next app start retries scheduling */ }
                }
                call.resolve(JSObject.fromJSONObject(result));
            } catch (IllegalArgumentException error) {
                call.reject(error.getMessage() == null ? "Invalid local data." : error.getMessage(), "invalid_local_data");
            } catch (Exception error) {
                call.reject("Local data operation failed: " + safeMessage(error), "local_database_error", error);
            }
        });
    }

    @PluginMethod public void getNotificationPermission(PluginCall call) {
        call.resolve(new JSObject().put("granted", hasNotificationPermission()));
    }

    @PluginMethod public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || hasNotificationPermission()) {
            call.resolve(new JSObject().put("granted", hasNotificationPermission()));
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback private void notificationPermissionCallback(PluginCall call) {
        call.resolve(new JSObject().put("granted", hasNotificationPermission()));
    }

    @PluginMethod public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= 26) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", getContext().getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) { call.reject("Could not open notification settings.", "notification_settings_error", error); }
    }

    @PluginMethod public void getAppLockState(PluginCall call) {
        android.content.SharedPreferences prefs = lockPreferences();
        boolean biometricAvailable = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
        boolean biometricEnabled = prefs.getBoolean("biometricEnabled", false);
        boolean pinEnabled = prefs.getBoolean("pinEnabled", false);
        call.resolve(new JSObject().put("supported", true).put("enabled", prefs.getBoolean("lockEnabled", false))
                .put("biometricEnabled", biometricEnabled).put("pinEnabled", pinEnabled)
                .put("biometricAvailable", biometricAvailable).put("hasPin", prefs.contains("pinHash") && prefs.contains("pinSalt")));
    }

    @PluginMethod public void updateAppLock(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        boolean biometricEnabled = call.getBoolean("biometricEnabled", false);
        boolean pinEnabled = call.getBoolean("pinEnabled", false);
        android.content.SharedPreferences prefs = lockPreferences();
        if (enabled && !biometricEnabled && !pinEnabled) { call.reject("Choose fingerprint/face or set a PIN before turning on App Lock.", "app_lock_method_required"); return; }
        if (pinEnabled && !(prefs.contains("pinHash") && prefs.contains("pinSalt"))) { call.reject("Set up a PIN before enabling PIN unlock.", "app_lock_pin_required"); return; }
        if (biometricEnabled && BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("No enrolled fingerprint or face unlock is available on this device.", "biometric_unavailable"); return;
        }
        prefs.edit().putBoolean("lockEnabled", enabled).putBoolean("biometricEnabled", biometricEnabled).putBoolean("pinEnabled", pinEnabled).apply();
        call.resolve(new JSObject().put("enabled", enabled).put("biometricEnabled", biometricEnabled).put("pinEnabled", pinEnabled));
    }

    @PluginMethod public void setAppLockPin(PluginCall call) {
        String pin = call.getString("pin");
        String confirmation = call.getString("confirmation");
        if (pin == null || !pin.matches("[0-9]{4,8}")) { call.reject("PIN must contain 4 to 8 digits.", "invalid_pin"); return; }
        if (!pin.equals(confirmation)) { call.reject("The PIN entries do not match.", "pin_mismatch"); return; }
        databaseExecutor.execute(() -> {
            char[] chars = pin.toCharArray();
            try {
                byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt);
                byte[] hash = derivePin(chars, salt);
                lockPreferences().edit().putString("pinSalt", Base64.encodeToString(salt, Base64.NO_WRAP))
                        .putString("pinHash", Base64.encodeToString(hash, Base64.NO_WRAP)).putBoolean("pinEnabled", true).apply();
                call.resolve(new JSObject().put("enabled", true).put("pinEnabled", true));
                Arrays.fill(hash, (byte) 0);
            } catch (Exception error) { call.reject("Could not securely save the PIN.", "pin_storage_error", error); }
            finally { Arrays.fill(chars, '\0'); }
        });
    }

    @PluginMethod public void verifyAppLockPin(PluginCall call) {
        String pin = call.getString("pin");
        if (pin == null || !pin.matches("[0-9]{4,8}")) { call.reject("Enter your 4 to 8 digit PIN.", "invalid_pin"); return; }
        databaseExecutor.execute(() -> {
            char[] chars = pin.toCharArray();
            try {
                android.content.SharedPreferences prefs = lockPreferences();
                if (!prefs.getBoolean("pinEnabled", false)) { call.reject("PIN unlock is not enabled.", "pin_disabled"); return; }
                long lockUntil = prefs.getLong("pinLockUntil", 0L);
                if (System.currentTimeMillis() < lockUntil) {
                    long seconds = Math.max(1L, (lockUntil - System.currentTimeMillis() + 999L) / 1000L);
                    call.reject("Too many incorrect attempts. Try again in " + seconds + " seconds.", "pin_temporarily_locked"); return;
                }
                byte[] salt = Base64.decode(prefs.getString("pinSalt", ""), Base64.NO_WRAP);
                byte[] expected = Base64.decode(prefs.getString("pinHash", ""), Base64.NO_WRAP);
                byte[] actual = derivePin(chars, salt);
                boolean matches = MessageDigest.isEqual(expected, actual);
                Arrays.fill(actual, (byte) 0);
                if (matches) {
                    prefs.edit().remove("pinFailureCount").remove("pinLockUntil").apply();
                    call.resolve(new JSObject().put("unlocked", true));
                } else {
                    int failures = prefs.getInt("pinFailureCount", 0) + 1;
                    if (failures >= 5) prefs.edit().putInt("pinFailureCount", 0).putLong("pinLockUntil", System.currentTimeMillis() + 30_000L).apply();
                    else prefs.edit().putInt("pinFailureCount", failures).apply();
                    call.reject(failures >= 5 ? "Too many incorrect attempts. Try again in 30 seconds." : "Incorrect PIN. Try again.", "incorrect_pin");
                }
            } catch (Exception error) { call.reject("Could not verify the PIN.", "pin_verification_error", error); }
            finally { Arrays.fill(chars, '\0'); }
        });
    }

    @PluginMethod public void authenticateAppLock(PluginCall call) {
        android.content.SharedPreferences prefs = lockPreferences();
        if (!prefs.getBoolean("lockEnabled", false) || !prefs.getBoolean("biometricEnabled", false)) { call.reject("Biometric unlock is not enabled.", "biometric_disabled"); return; }
        if (BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) != BiometricManager.BIOMETRIC_SUCCESS) { call.reject("Set up fingerprint or face unlock in Android settings first.", "biometric_unavailable"); return; }
        if (!(getActivity() instanceof FragmentActivity)) { call.reject("Biometric unlock is unavailable in this app session.", "biometric_unavailable"); return; }
        FragmentActivity host = (FragmentActivity) getActivity();
        host.runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt(host, ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) { call.resolve(new JSObject().put("unlocked", true)); }
                    @Override public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) { call.reject(errString.toString(), "biometric_authentication_cancelled"); }
                    @Override public void onAuthenticationFailed() { /* prompt remains open; Android displays the retry state */ }
                });
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Attendance Tracker")
                        .setSubtitle("Use your device fingerprint or face unlock").setNegativeButtonText("Cancel")
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK).build();
                prompt.authenticate(info);
            } catch (Exception error) {
                call.reject("Could not open biometric unlock. Use your PIN or try again.", "biometric_prompt_error", error);
            }
        });
    }

    private android.content.SharedPreferences lockPreferences() { return getContext().getSharedPreferences("app_lock_preferences", android.content.Context.MODE_PRIVATE); }
    private static byte[] derivePin(char[] pin, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pin, salt, 160000, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); }
    }

    @PluginMethod public void exportBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "attendance-tracker-backup.json");
        startActivityForResult(call, intent, "handleBackupExportResult");
    }

    @ActivityCallback private void handleBackupExportResult(@NonNull PluginCall call, @NonNull ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true)); return;
        }
        Uri uri = result.getData().getData();
        databaseExecutor.execute(() -> {
            try {
                JSONObject backup = repository.execute("backup.snapshot", new JSONObject());
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IllegalStateException("Could not open the selected backup file.");
                    output.write(backup.toString(2).getBytes(StandardCharsets.UTF_8)); output.flush();
                }
                call.resolve(new JSObject().put("cancelled", false).put("exported", true));
            } catch (Exception error) { call.reject("Could not export the local backup: " + safeMessage(error), "backup_export_error", error); }
        });
    }

    @PluginMethod public void importBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleBackupImportResult");
    }

    @PluginMethod public void pickTimetableImage(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/jpeg", "image/png"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleTimetableImageResult");
    }

    @ActivityCallback private void handleTimetableImageResult(@NonNull PluginCall call, @NonNull ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true)); return;
        }
        Uri uri = result.getData().getData();
        try {
            String mime = getContext().getContentResolver().getType(uri);
            String name = displayName(uri).toLowerCase(java.util.Locale.ROOT);
            boolean jpeg = "image/jpeg".equalsIgnoreCase(mime) || name.endsWith(".jpg") || name.endsWith(".jpeg");
            boolean png = "image/png".equalsIgnoreCase(mime) || name.endsWith(".png");
            if (!jpeg && !png) { call.reject("Choose a JPG or PNG timetable image.", "unsupported_image_type"); return; }
            InputImage image = InputImage.fromFilePath(getContext(), uri);
            com.google.mlkit.vision.text.TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            recognizer.process(image)
                    .addOnSuccessListener(text -> {
                        try {
                            org.json.JSONArray lines = new org.json.JSONArray();
                            for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines()) {
                                android.graphics.Rect bounds = line.getBoundingBox();
                                if (bounds == null || line.getText() == null || line.getText().trim().isEmpty()) continue;
                                org.json.JSONArray elements = new org.json.JSONArray();
                                for (Text.Element element : line.getElements()) {
                                    android.graphics.Rect elementBounds = element.getBoundingBox();
                                    if (elementBounds == null || element.getText() == null || element.getText().trim().isEmpty()) continue;
                                    elements.put(new JSONObject().put("text", element.getText().trim())
                                            .put("left", elementBounds.left / (double) image.getWidth()).put("top", elementBounds.top / (double) image.getHeight())
                                            .put("right", elementBounds.right / (double) image.getWidth()).put("bottom", elementBounds.bottom / (double) image.getHeight())
                                            .put("centerX", elementBounds.centerX() / (double) image.getWidth()).put("centerY", elementBounds.centerY() / (double) image.getHeight()));
                                }
                                lines.put(new JSONObject().put("text", line.getText().trim()).put("elements", elements)
                                        .put("left", bounds.left / (double) image.getWidth()).put("top", bounds.top / (double) image.getHeight())
                                        .put("right", bounds.right / (double) image.getWidth()).put("bottom", bounds.bottom / (double) image.getHeight())
                                        .put("centerX", bounds.centerX() / (double) image.getWidth()).put("centerY", bounds.centerY() / (double) image.getHeight()));
                            }
                            recognizer.close();
                            call.resolve(new JSObject().put("cancelled", false).put("width", image.getWidth()).put("height", image.getHeight()).put("lines", lines));
                        } catch (Exception error) { recognizer.close(); call.reject("Could not read the recognized timetable text.", "timetable_ocr_error", error); }
                    })
                    .addOnFailureListener(error -> { recognizer.close(); call.reject("Text could not be read from this image. Try a clearer JPG or PNG photo.", "timetable_ocr_error", error); });
        } catch (Exception error) {
            call.reject("Could not open this image. Choose a clear JPG or PNG file.", "timetable_image_error", error);
        }
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] {android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) { }
        return "";
    }

    @ActivityCallback private void handleBackupImportResult(@NonNull PluginCall call, @NonNull ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true)); return;
        }
        Uri uri = result.getData().getData();
        databaseExecutor.execute(() -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IllegalArgumentException("Could not read the selected backup file.");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream(); byte[] part = new byte[8192]; int read; int total = 0;
                while ((read = input.read(part)) != -1) { total += read; if (total > 25 * 1024 * 1024) throw new IllegalArgumentException("Backup file is larger than 25 MB."); buffer.write(part, 0, read); }
                JSONObject payload = new JSONObject().put("backup", new JSONObject(buffer.toString(StandardCharsets.UTF_8.name())));
                JSONObject resultJson = repository.execute("backup.restore", payload);
                call.resolve(JSObject.fromJSONObject(resultJson));
            } catch (IllegalArgumentException error) { call.reject(error.getMessage(), "invalid_backup"); }
            catch (Exception error) { call.reject("Could not restore the backup: " + safeMessage(error), "backup_import_error", error); }
        });
    }

    @Override protected void handleOnDestroy() {
        databaseExecutor.shutdown();
        super.handleOnDestroy();
    }

    private static String safeMessage(@Nullable Exception error) {
        if (error == null) return "Unknown error.";
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private boolean hasNotificationPermission() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled()
                && (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
    }

    private static boolean affectsNotifications(String action) {
        return "semester.save".equals(action) || "semester.create".equals(action) || "semester.select".equals(action) || "semester.delete".equals(action)
                || "subject.update".equals(action)
                || "timetable.create".equals(action) || "timetable.update".equals(action) || "timetable.active".equals(action) || "timetable.delete".equals(action)
                || "holiday.create".equals(action) || "holiday.delete".equals(action) || "manual.commit".equals(action)
                || "notifications.settings.save".equals(action) || "backup.restore".equals(action)
                || "timetable.import".equals(action) || "timetable.clear".equals(action);
    }

    private static boolean shouldReconcileScheduler(String action) {
        return "scheduler.update".equals(action)
                || "semester.save".equals(action) || "semester.create".equals(action) || "semester.select".equals(action) || "semester.delete".equals(action)
                || "subject.create".equals(action) || "subject.update".equals(action) || "subject.delete".equals(action)
                || "timetable.create".equals(action) || "timetable.update".equals(action) || "timetable.active".equals(action) || "timetable.delete".equals(action)
                || "timetable.import".equals(action) || "timetable.clear".equals(action)
                || "holiday.create".equals(action) || "holiday.delete".equals(action) || "backup.restore".equals(action) || "manual.commit".equals(action);
    }
}
