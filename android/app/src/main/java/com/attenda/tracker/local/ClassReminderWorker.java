package com.attenda.tracker.local;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONObject;

public final class ClassReminderWorker extends Worker {
    public ClassReminderWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }

    @NonNull @Override public Result doWork() {
        try {
            Context context = getApplicationContext();
            LocalAttendanceRepository repository = new LocalAttendanceRepository(context);
            if (!repository.execute("notifications.settings.get", new JSONObject()).optBoolean("classReminders") || !LocalNotificationScheduler.notificationsAllowed(context)) return Result.success();
            JSONObject check = repository.execute("notifications.classReminder", new JSONObject()
                    .put("entryId", getInputData().getString("entryId"))
                    .put("semesterId", getInputData().getString("semesterId"))
                    .put("date", getInputData().getString("date")));
            if (!check.optBoolean("valid")) return Result.success();
            LocalNotificationScheduler.showClassReminder(context,
                    getInputData().getString("entryId"), getInputData().getString("semesterId"),
                    getInputData().getString("date"), check.getString("subject"), getInputData().getString("code"),
                    check.getString("start"), check.optString("room", ""));
            return Result.success();
        } catch (Exception error) { return Result.retry(); }
    }
}
