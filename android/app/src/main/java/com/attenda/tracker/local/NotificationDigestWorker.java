package com.attenda.tracker.local;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONObject;

public final class NotificationDigestWorker extends Worker {
    public NotificationDigestWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }

    @NonNull @Override public Result doWork() {
        try {
            Context context = getApplicationContext();
            LocalAttendanceRepository repository = new LocalAttendanceRepository(context);
            if (repository.execute("notifications.settings.get", new JSONObject()).optBoolean("dailySummary") && LocalNotificationScheduler.notificationsAllowed(context)) {
                JSONObject summary = repository.execute("notifications.summary", new JSONObject());
                if (summary.optBoolean("shouldNotify") && !summary.optBoolean("alreadySent")) {
                    LocalNotificationScheduler.showDailySummary(context, summary);
                    repository.execute("notifications.summary.markSent", new JSONObject().put("date", summary.getString("date")));
                }
            }
            return Result.success();
        } catch (Exception error) { return Result.retry(); }
    }
}
