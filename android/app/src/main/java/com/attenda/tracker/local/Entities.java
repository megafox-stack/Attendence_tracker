package com.attenda.tracker.local;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.ForeignKey;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** Local, user-owned data records. Dates and local class times use ISO strings. */
public final class Entities {
    private Entities() {}

    @Entity(tableName = "semesters", indices = {@Index("status"), @Index("startDate"), @Index("endDate")})
    public static class Semester {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String name = "";
        @NonNull public String startDate = "";
        @NonNull public String endDate = "";
        public int workingDaysMask;
        public Double attendanceTargetPercent;
        @NonNull public String status = "draft";
        @NonNull public String timeZone = "UTC";
    }

    @Entity(tableName = "subjects", foreignKeys = @ForeignKey(entity = Semester.class, parentColumns = "id", childColumns = "semesterId", onDelete = ForeignKey.RESTRICT), indices = {@Index("semesterId"), @Index(value = {"semesterId", "code"}, unique = true)})
    public static class Subject {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String semesterId = "";
        @NonNull public String name = "";
        @NonNull public String code = "";
        public Double attendanceTargetPercent;
        public boolean active = true;
    }

    @Entity(tableName = "timetable_entries", foreignKeys = {
            @ForeignKey(entity = Semester.class, parentColumns = "id", childColumns = "semesterId", onDelete = ForeignKey.RESTRICT),
            @ForeignKey(entity = Subject.class, parentColumns = "id", childColumns = "subjectId", onDelete = ForeignKey.RESTRICT)
    }, indices = {@Index("semesterId"), @Index("subjectId"), @Index(value = {"semesterId", "day", "active", "start"})})
    public static class TimetableEntry {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String semesterId = "";
        @NonNull public String subjectId = "";
        @NonNull public String day = "";
        @NonNull public String start = "";
        @NonNull public String end = "";
        public String room;
        @NonNull public String effectiveFrom = "";
        @NonNull public String effectiveUntil = "";
        public boolean active = true;
        public boolean historicalOnly = false;
    }

    @Entity(tableName = "class_occurrences", foreignKeys = {
            @ForeignKey(entity = Semester.class, parentColumns = "id", childColumns = "semesterId", onDelete = ForeignKey.RESTRICT),
            @ForeignKey(entity = TimetableEntry.class, parentColumns = "id", childColumns = "timetableEntryId", onDelete = ForeignKey.RESTRICT),
            @ForeignKey(entity = Subject.class, parentColumns = "id", childColumns = "subjectId", onDelete = ForeignKey.RESTRICT)
    }, indices = {@Index(value = {"timetableEntryId", "classDate"}, unique = true), @Index(value = {"classDate", "start"}), @Index(value = {"subjectId", "classDate"}), @Index("semesterId"), @Index("status")})
    public static class ClassOccurrence {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String semesterId = "";
        @NonNull public String timetableEntryId = "";
        @NonNull public String subjectId = "";
        @NonNull public String classDate = "";
        @NonNull public String start = "";
        @NonNull public String end = "";
        @NonNull public String subjectNameSnapshot = "";
        @NonNull public String subjectCodeSnapshot = "";
        public String roomSnapshot;
        @NonNull public String status = "PENDING";
        public String note;
        public long generatedAt;
        public Long finalizedAt;
    }

    @Entity(tableName = "holidays", foreignKeys = @ForeignKey(entity = Semester.class, parentColumns = "id", childColumns = "semesterId", onDelete = ForeignKey.RESTRICT), indices = {@Index("semesterId"), @Index(value = {"semesterId", "date"}, unique = true)})
    public static class Holiday {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String semesterId = "";
        @NonNull public String date = "";
        public String reason;
    }

    @Entity(tableName = "attendance_changes", foreignKeys = @ForeignKey(entity = ClassOccurrence.class, parentColumns = "id", childColumns = "occurrenceId", onDelete = ForeignKey.CASCADE), indices = {@Index("occurrenceId"), @Index("changedAt")})
    public static class AttendanceChange {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String occurrenceId = "";
        @NonNull public String actorType = "user";
        @NonNull public String oldStatus = "";
        @NonNull public String newStatus = "";
        public String reason;
        public long changedAt;
    }

    @Entity(tableName = "app_settings")
    public static class AppSetting {
        @PrimaryKey @NonNull public String key = "";
        @NonNull public String value = "";
    }
}
