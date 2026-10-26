package com.attenda.tracker.local;

import androidx.annotation.NonNull;
import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Update;
import com.attenda.tracker.local.Entities.AppSetting;
import com.attenda.tracker.local.Entities.AttendanceChange;
import com.attenda.tracker.local.Entities.ClassOccurrence;
import com.attenda.tracker.local.Entities.Holiday;
import com.attenda.tracker.local.Entities.Semester;
import com.attenda.tracker.local.Entities.Subject;
import com.attenda.tracker.local.Entities.TimetableEntry;
import java.util.List;

public final class AttendanceDaos {
    private AttendanceDaos() {}

    @Dao public interface SemesterDao {
        @Query("SELECT * FROM semesters ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, startDate DESC, id DESC") List<Semester> all();
        @Query("SELECT * FROM semesters WHERE status IN ('active','draft') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, startDate DESC, id DESC LIMIT 1") Semester current();
        @Query("SELECT * FROM semesters WHERE id=:id LIMIT 1") Semester byId(String id);
        @Insert(onConflict = OnConflictStrategy.ABORT) void insert(Semester row);
        @Update void update(Semester row);
        @Query("DELETE FROM semesters WHERE id=:id") int delete(String id);
    }

    @Dao public interface SubjectDao {
        @Query("SELECT * FROM subjects WHERE semesterId=:semesterId ORDER BY name, code") List<Subject> bySemester(String semesterId);
        @Query("SELECT * FROM subjects WHERE id=:id LIMIT 1") Subject byId(String id);
        @Insert(onConflict = OnConflictStrategy.ABORT) void insert(Subject row);
        @Update void update(Subject row);
        @Query("DELETE FROM subjects WHERE id=:id") int delete(String id);
        @Query("SELECT COUNT(*) FROM timetable_entries WHERE subjectId=:id") int entryCount(String id);
        @Query("SELECT COUNT(*) FROM class_occurrences WHERE subjectId=:id") int occurrenceCount(String id);
        @Query("DELETE FROM subjects WHERE semesterId=:semesterId") int deleteBySemester(String semesterId);
    }

    @Dao public interface TimetableDao {
        @Query("SELECT * FROM timetable_entries WHERE semesterId=:semesterId AND historicalOnly=0 ORDER BY day, start, id") List<TimetableEntry> bySemester(String semesterId);
        @Query("SELECT * FROM timetable_entries WHERE semesterId=:semesterId ORDER BY day, start, id") List<TimetableEntry> allBySemester(String semesterId);
        @Query("SELECT * FROM timetable_entries WHERE id=:id LIMIT 1") TimetableEntry byId(String id);
        @Query("SELECT * FROM timetable_entries WHERE semesterId=:semesterId AND day=:day AND active=1 AND start < :end AND end > :start AND (:exceptId IS NULL OR id != :exceptId) LIMIT 1") TimetableEntry overlap(String semesterId, String day, String start, String end, String exceptId);
        @Insert(onConflict = OnConflictStrategy.ABORT) void insert(TimetableEntry row);
        @Update void update(TimetableEntry row);
        @Query("DELETE FROM timetable_entries WHERE id=:id") int delete(String id);
        @Query("SELECT COUNT(*) FROM class_occurrences WHERE timetableEntryId=:id") int occurrenceCount(String id);
        @Query("UPDATE timetable_entries SET effectiveFrom=:start, effectiveUntil=:end WHERE semesterId=:semesterId AND historicalOnly=0") int updateEffectiveDates(String semesterId, String start, String end);
        @Query("DELETE FROM timetable_entries WHERE semesterId=:semesterId") int deleteBySemester(String semesterId);
    }

    @Dao public interface OccurrenceDao {
        @Query("SELECT * FROM class_occurrences WHERE classDate=:date ORDER BY start, id") List<ClassOccurrence> byDate(String date);
        @Query("SELECT * FROM class_occurrences ORDER BY classDate DESC, start DESC, id DESC LIMIT 500") List<ClassOccurrence> recent();
        @Query("SELECT * FROM class_occurrences WHERE id=:id LIMIT 1") ClassOccurrence byId(String id);
        @Query("SELECT * FROM class_occurrences WHERE timetableEntryId=:entryId AND classDate=:date LIMIT 1") ClassOccurrence byEntryDate(String entryId, String date);
        @Query("SELECT * FROM class_occurrences WHERE subjectId=:subjectId ORDER BY classDate DESC, start DESC") List<ClassOccurrence> bySubject(String subjectId);
        @Insert(onConflict = OnConflictStrategy.IGNORE) long insertIgnore(ClassOccurrence row);
        @Update void update(ClassOccurrence row);
        @Insert(onConflict = OnConflictStrategy.ABORT) void insert(ClassOccurrence row);
        @Query("DELETE FROM class_occurrences WHERE id=:id") int delete(String id);
        @Query("DELETE FROM class_occurrences WHERE semesterId=:semesterId") int deleteBySemester(String semesterId);
        @Query("SELECT COUNT(*) FROM class_occurrences") int countAll();
        @Query("DELETE FROM class_occurrences") int deleteAll();
    }

    @Dao public interface HolidayDao {
        @Query("SELECT * FROM holidays WHERE semesterId=:semesterId ORDER BY date") List<Holiday> bySemester(String semesterId);
        @Query("SELECT * FROM holidays WHERE semesterId=:semesterId AND date=:date LIMIT 1") Holiday byDate(String semesterId, String date);
        @Insert(onConflict = OnConflictStrategy.ABORT) void insert(Holiday row);
        @Query("DELETE FROM holidays WHERE id=:id") int delete(String id);
    }

    @Dao public interface ChangeDao {
        @Query("SELECT * FROM attendance_changes WHERE occurrenceId=:occurrenceId ORDER BY changedAt, id") List<AttendanceChange> byOccurrence(String occurrenceId);
        @Insert(onConflict = OnConflictStrategy.ABORT) void insert(AttendanceChange row);
        @Query("SELECT COUNT(*) FROM attendance_changes") int countAll();
        @Query("DELETE FROM attendance_changes") int deleteAll();
    }

    @Dao public interface SettingsDao {
        @Query("SELECT * FROM app_settings ORDER BY `key`") List<AppSetting> all();
        @Query("SELECT value FROM app_settings WHERE `key`=:key LIMIT 1") String get(String key);
        @Insert(onConflict = OnConflictStrategy.REPLACE) void put(AppSetting setting);
        @Query("DELETE FROM app_settings WHERE `key`=:key") int delete(String key);
    }
}
