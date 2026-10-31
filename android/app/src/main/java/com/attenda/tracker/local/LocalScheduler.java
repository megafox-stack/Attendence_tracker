package com.attenda.tracker.local;

import android.content.Context;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Data;
import java.util.concurrent.TimeUnit;

public final class LocalScheduler {
    private static final String PERIODIC = "attendance-local-daily-scheduler";
    private static final String CATCH_UP = "attendance-local-scheduler-catch-up";
    private static final String CLASS_END_CHECK = "attendance-local-class-end-check";
    private static final String CLASS_END_CHECK_INPUT = "classEndCheck";
    private LocalScheduler() {}

    public static void ensurePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(LocalSchedulerWorker.class, 24, TimeUnit.HOURS).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    public static void enable(Context context) {
        ensurePeriodic(context);
        WorkManager.getInstance(context).enqueueUniqueWork(CATCH_UP, ExistingWorkPolicy.REPLACE, new OneTimeWorkRequest.Builder(LocalSchedulerWorker.class).build());
    }

    public static void disable(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC);
        WorkManager.getInstance(context).cancelUniqueWork(CATCH_UP);
        WorkManager.getInstance(context).cancelUniqueWork(CLASS_END_CHECK);
    }

    public static void refreshClassEndCheck(Context context, LocalAttendanceRepository repository) throws Exception {
        WorkManager manager = WorkManager.getInstance(context);
        manager.cancelUniqueWork(CLASS_END_CHECK);
        long nextRunAt = repository.nextSchedulerClassEndMillis();
        if (nextRunAt <= 0) return;
        manager.enqueueUniqueWork(CLASS_END_CHECK, ExistingWorkPolicy.REPLACE, classEndRequest(nextRunAt));
    }

    static void scheduleFollowingClassEndCheck(Context context, LocalAttendanceRepository repository) throws Exception {
        long nextRunAt = repository.nextSchedulerClassEndMillis();
        if (nextRunAt <= 0) return;
        WorkManager.getInstance(context).enqueueUniqueWork(CLASS_END_CHECK, ExistingWorkPolicy.APPEND_OR_REPLACE, classEndRequest(nextRunAt));
    }

    private static OneTimeWorkRequest classEndRequest(long runAtMillis) {
        long delay = Math.max(0L, runAtMillis - System.currentTimeMillis());
        Data input = new Data.Builder().putBoolean(CLASS_END_CHECK_INPUT, true).build();
        return new OneTimeWorkRequest.Builder(LocalSchedulerWorker.class)
                .setInputData(input)
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .build();
    }

    static boolean isClassEndCheck(Data input) {
        return input.getBoolean(CLASS_END_CHECK_INPUT, false);
    }
}
