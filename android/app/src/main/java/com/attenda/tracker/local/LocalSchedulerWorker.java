package com.attenda.tracker.local;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class LocalSchedulerWorker extends Worker {
    public LocalSchedulerWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    @NonNull @Override public Result doWork() {
        try { new LocalAttendanceRepository(getApplicationContext()).runSchedulerTick(); return Result.success(); }
        catch (IllegalArgumentException error) { return Result.failure(); }
        catch (Exception error) { return Result.retry(); }
    }
}
