package com.attenda.tracker.local;

import android.content.Context;
import android.content.Intent;
import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.attenda.tracker.MainActivity;
import com.attenda.tracker.R;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local-only notification scheduling and delivery. Android may defer this work for battery life. */
public final class LocalNotificationScheduler {
    static final String CLASS_TAG = "attendance-class-reminder";
    private static final String CLASS_REFRESH = "attendance-class-reminder-refresh";
    private static final String DAILY_DIGEST = "attendance-daily-notification-summary";
    private static final String CHANNEL_CLASSES = "attendance_class_reminders";
    private static final String CHANNEL_DIGEST = "attendance_daily_summary";
    private LocalNotificationScheduler() {}

    public static void sync(Context context, LocalAttendanceRepository repository) throws Exception {
        JSONObject settings = repository.execute("notifications.settings.get", new JSONObject());
        WorkManager work = WorkManager.getInstance(context);
        if (settings.optBoolean("classReminders")) {
            refreshClassReminders(context, repository);
            PeriodicWorkRequest refresh = new PeriodicWorkRequest.Builder(NotificationRefreshWorker.class, 24, TimeUnit.HOURS)
                    .setInitialDelay(24, TimeUnit.HOURS).build();
            work.enqueueUniquePeriodicWork(CLASS_REFRESH, ExistingPeriodicWorkPolicy.KEEP, refresh);
        } else {
            work.cancelAllWorkByTag(CLASS_TAG);
            work.cancelUniqueWork(CLASS_REFRESH);
        }
        if (settings.optBoolean("dailySummary")) {
            JSONObject current = repository.execute("semester.getCurrent", new JSONObject()).optJSONObject("semester");
            ZoneId zone = current == null ? ZoneId.systemDefault() : ZoneId.of(current.optString("timeZone", ZoneId.systemDefault().getId()));
            long delay = millisUntilNextEightPm(zone);
            PeriodicWorkRequest summary = new PeriodicWorkRequest.Builder(NotificationDigestWorker.class, 24, TimeUnit.HOURS)
                    .setInitialDelay(delay, TimeUnit.MILLISECONDS).build();
            work.enqueueUniquePeriodicWork(DAILY_DIGEST, ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE, summary);
        } else work.cancelUniqueWork(DAILY_DIGEST);
    }

    static void refreshClassReminders(Context context, LocalAttendanceRepository repository) throws Exception {
        WorkManager work = WorkManager.getInstance(context);
        work.cancelAllWorkByTag(CLASS_TAG);
        JSONObject response = repository.execute("notifications.reminders", new JSONObject().put("days", 14));
        JSONArray reminders = response.getJSONArray("reminders");
        for (int i = 0; i < reminders.length(); i++) {
            JSONObject reminder = reminders.getJSONObject(i);
            Data data = new Data.Builder()
                    .putString("entryId", reminder.getString("entryId"))
                    .putString("semesterId", reminder.getString("semesterId"))
                    .putString("date", reminder.getString("date"))
                    .putString("subject", reminder.getString("subject"))
                    .putString("code", reminder.getString("code"))
                    .putString("start", reminder.getString("start"))
                    .putString("room", reminder.isNull("room") ? "" : reminder.getString("room"))
                    .build();
            long delay = Math.max(0L, reminder.getLong("fireAt") - System.currentTimeMillis());
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ClassReminderWorker.class)
                    .setInputData(data).setInitialDelay(delay, TimeUnit.MILLISECONDS).addTag(CLASS_TAG).build();
            String unique = "attendance-class-" + reminder.getString("entryId") + "-" + reminder.getString("date");
            work.enqueueUniqueWork(unique, ExistingWorkPolicy.REPLACE, request);
        }
    }

    static boolean notificationsAllowed(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    static void showClassReminder(Context context, String entryId, String semesterId, String date, String subject, String code, String start, String room) throws Exception {
        ensureChannels(context);
        int id = (entryId + "|" + date).hashCode() & 0x7fffffff;
        post(context, CHANNEL_CLASSES, id, "Upcoming class", subject + " (" + code + ") starts at " + start + (room.isEmpty() ? "" : " · " + room), "/timetable");
    }

    static void showDailySummary(Context context, JSONObject summary) throws Exception {
        ensureChannels(context);
        int pending = summary.optInt("pending");
        int below = summary.optInt("belowTarget");
        if (pending == 0 && below == 0) return;
        String body;
        if (pending > 0 && below > 0) body = pending + " class" + (pending == 1 ? "" : "es") + " to review · " + below + " subject" + (below == 1 ? "" : "s") + " below target.";
        else if (pending > 0) body = pending + " class" + (pending == 1 ? " still needs" : "es still need") + " attendance review today.";
        else body = below + " subject" + (below == 1 ? " is" : "s are") + " below the configured attendance target.";
        String route = pending > 0 ? "/review?date=" + summary.getString("date") : "/attendance";
        post(context, CHANNEL_DIGEST, ("daily|" + summary.getString("date")).hashCode() & 0x7fffffff, "Attendance summary", body, route);
    }

    private static void post(Context context, String channelId, int id, String title, String body, String route) {
        if (!notificationsAllowed(context)) return;
        Intent intent = new Intent(context, MainActivity.class)
                .putExtra("notificationRoute", route)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.setData(android.net.Uri.parse("attendance://notification/" + id));
        PendingIntent pendingIntent = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try { NotificationManagerCompat.from(context).notify(id, builder.build()); } catch (SecurityException ignored) { /* Permission may have changed while work was running. */ }
    }

    private static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_CLASSES, "Class reminders", NotificationManager.IMPORTANCE_DEFAULT));
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_DIGEST, "Attendance summary", NotificationManager.IMPORTANCE_DEFAULT));
    }

    private static long millisUntilNextEightPm(ZoneId zone) {
        LocalDateTime now = LocalDateTime.now(zone);
        LocalDateTime next = now.with(LocalTime.of(20, 0));
        if (!next.isAfter(now)) next = next.plusDays(1);
        return Math.max(1L, Duration.between(now, next).toMillis());
    }
}
