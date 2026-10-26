package com.attenda.tracker.local;

import android.content.Context;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

public final class LocalScheduler {
    private static final String PERIODIC = "attendance-local-daily-scheduler";
    private static final String CATCH_UP = "attendance-local-scheduler-catch-up";
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
    }
}
