package com.attenda.tracker.local;

import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "LocalAttendance")
public final class LocalAttendancePlugin extends Plugin {
    private final ExecutorService databaseExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "attendance-room"); thread.setDaemon(true); return thread;
    });
    private LocalAttendanceRepository repository;

    @Override public void load() {
        super.load();
        repository = new LocalAttendanceRepository(getContext());
        LocalScheduler.ensurePeriodic(getContext());
        databaseExecutor.execute(() -> { try { repository.runSchedulerTick(); } catch (Exception ignored) { /* surfaced through scheduler status */ } });
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
                call.resolve(JSObject.fromJSONObject(result));
            } catch (IllegalArgumentException error) {
                call.reject(error.getMessage() == null ? "Invalid local data." : error.getMessage(), "invalid_local_data");
            } catch (Exception error) {
                call.reject("Local data operation failed: " + safeMessage(error), "local_database_error", error);
            }
        });
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
}
