package com.attenda.tracker.local;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONObject;

public final class NotificationRefreshWorker extends Worker {
    public NotificationRefreshWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }

    @NonNull @Override public Result doWork() {
        try {
            Context context = getApplicationContext();
            LocalAttendanceRepository repository = new LocalAttendanceRepository(context);
            if (repository.execute("notifications.settings.get", new JSONObject()).optBoolean("classReminders")) LocalNotificationScheduler.refreshClassReminders(context, repository);
            return Result.success();
        } catch (Exception error) { return Result.retry(); }
    }
}
