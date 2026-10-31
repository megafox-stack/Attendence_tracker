package com.attenda.tracker.local;

import androidx.room.Database;
import androidx.room.RoomDatabase;
import com.attenda.tracker.local.AttendanceDaos.ChangeDao;
import com.attenda.tracker.local.AttendanceDaos.HolidayDao;
import com.attenda.tracker.local.AttendanceDaos.OccurrenceDao;
import com.attenda.tracker.local.AttendanceDaos.SemesterDao;
import com.attenda.tracker.local.AttendanceDaos.SettingsDao;
import com.attenda.tracker.local.AttendanceDaos.SubjectDao;
import com.attenda.tracker.local.AttendanceDaos.TimetableDao;
import com.attenda.tracker.local.Entities.AppSetting;
import com.attenda.tracker.local.Entities.AttendanceChange;
import com.attenda.tracker.local.Entities.ClassOccurrence;
import com.attenda.tracker.local.Entities.Holiday;
import com.attenda.tracker.local.Entities.Semester;
import com.attenda.tracker.local.Entities.Subject;
import com.attenda.tracker.local.Entities.TimetableEntry;

@Database(entities = {Semester.class, Subject.class, TimetableEntry.class, ClassOccurrence.class, Holiday.class, AttendanceChange.class, AppSetting.class}, version = 1, exportSchema = true)
public abstract class AttendanceDatabase extends RoomDatabase {
    public abstract SemesterDao semesters();
    public abstract SubjectDao subjects();
    public abstract TimetableDao timetable();
    public abstract OccurrenceDao occurrences();
    public abstract HolidayDao holidays();
    public abstract ChangeDao changes();
    public abstract SettingsDao settings();
}
