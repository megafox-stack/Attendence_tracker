package com.attenda.tracker.local;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class LocalSchedulerWorker extends Worker {
    public LocalSchedulerWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    @NonNull @Override public Result doWork() {
        try {
            LocalAttendanceRepository repository = new LocalAttendanceRepository(getApplicationContext());
            repository.runSchedulerTick();
            if (LocalScheduler.isClassEndCheck(getInputData())) {
                LocalScheduler.scheduleFollowingClassEndCheck(getApplicationContext(), repository);
            }
            return Result.success();
        }
        catch (IllegalArgumentException error) { return Result.failure(); }
        catch (Exception error) { return Result.retry(); }
    }
}
