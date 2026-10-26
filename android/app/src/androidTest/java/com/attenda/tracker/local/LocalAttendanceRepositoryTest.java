package com.attenda.tracker.local;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;

import android.content.Context;
import androidx.room.Room;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LocalAttendanceRepositoryTest {
    private AttendanceDatabase database;
    private LocalAttendanceRepository repository;

    @Before public void setUp() {
        Context context = ApplicationProvider.getApplicationContext();
        database = Room.inMemoryDatabaseBuilder(context, AttendanceDatabase.class).allowMainThreadQueries().build();
        repository = new LocalAttendanceRepository(database);
    }

    @After public void tearDown() { database.close(); }

    @Test public void generationIsIdempotentAndDoesNotOverwriteReviewedStatus() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        if (date.isBefore(LocalDate.now())) date = LocalDate.now();
        String day = dayName(date.getDayOfWeek());
        seed(date, day);

        JSONObject first = repository.execute("attendance.generate", new JSONObject().put("date", date.toString()));
        assertEquals(1, first.getInt("created"));
        String id = first.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", id).put("status", "Present"));

        JSONObject again = repository.execute("attendance.generate", new JSONObject().put("date", date.toString()));
        assertEquals(0, again.getInt("created"));
        assertEquals("Present", again.getJSONArray("records").getJSONObject(0).getString("status"));
    }

    @Test public void sameSubjectAtTwoTimesOnSameDayGetsSeparateOccurrences() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        String day = dayName(date.getDayOfWeek());
        seed(date, day);
        String subjectId = database.subjects().bySemester(database.semesters().current().id).get(0).id;
        repository.execute("timetable.create", new JSONObject().put("subjectId", subjectId).put("day", day).put("start", "11:00").put("end", "12:00"));

        JSONObject result = repository.execute("attendance.generate", new JSONObject().put("date", date.toString()));
        assertEquals(2, result.getInt("created"));
        assertEquals(2, result.getJSONArray("records").length());
    }

    @Test public void holidayCancelsPendingRecordsWithoutDeletingTimetable() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        String day = dayName(date.getDayOfWeek());
        String entryId = seed(date, day);
        repository.execute("attendance.generate", new JSONObject().put("date", date.toString()));
        JSONObject result = repository.execute("holiday.create", new JSONObject().put("date", date.toString()).put("reason", "Campus closed"));
        assertEquals(1, result.getInt("pendingRecordsCancelled"));
        assertEquals("Cancelled", repository.execute("attendance.classes", new JSONObject().put("date", date.toString())).getJSONArray("records").getJSONObject(0).getString("status"));
        assertNotNull(database.timetable().byId(entryId));
        assertEquals(1, database.holidays().bySemester(database.semesters().current().id).size());
    }

    @Test public void malformedRestoreDoesNotChangeExistingDatabase() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        seed(date, dayName(date.getDayOfWeek()));
        JSONObject malformed = new JSONObject().put("format", "attendance-tracker-backup").put("version", 1).put("data", new JSONObject().put("semesters", new JSONArray()));
        assertThrows(IllegalArgumentException.class, () -> repository.execute("backup.restore", new JSONObject().put("backup", malformed)));
        assertEquals(1, database.semesters().all().size());
        assertEquals(1, database.subjects().bySemester(database.semesters().current().id).size());
    }

    @Test public void backupRoundTripRestoresAllRelatedRecords() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        String day = dayName(date.getDayOfWeek());
        seed(date, day);
        JSONObject generated = repository.execute("attendance.generate", new JSONObject().put("date", date.toString()));
        String id = generated.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", id).put("status", "Absent").put("reason", "User correction"));
        JSONObject backup = repository.execute("backup.snapshot", new JSONObject());
        database.semesters().current().name = "Changed after export";
        database.semesters().update(database.semesters().current());

        repository.execute("backup.restore", new JSONObject().put("backup", backup));
        assertEquals("Test term", database.semesters().current().name);
        assertEquals(1, database.occurrences().countAll());
        assertEquals(1, database.changes().countAll());
        assertEquals("Absent", repository.execute("attendance.classes", new JSONObject().put("date", date.toString())).getJSONArray("records").getJSONObject(0).getString("status"));
    }

    @Test public void databaseConstraintFailureRollsBackRestore() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        seed(date, dayName(date.getDayOfWeek()));
        JSONObject backup = repository.execute("backup.snapshot", new JSONObject());
        JSONObject data = backup.getJSONObject("data");
        JSONObject duplicate = new JSONObject(data.getJSONArray("subjects").getJSONObject(0).toString()).put("id", "another-subject-id");
        data.getJSONArray("subjects").put(duplicate);

        assertThrows(RuntimeException.class, () -> repository.execute("backup.restore", new JSONObject().put("backup", backup)));
        assertEquals(1, database.semesters().all().size());
        assertEquals(1, database.subjects().bySemester(database.semesters().current().id).size());
    }

    @Test public void percentageUsesOnlyPresentAndAbsent() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        seed(date, dayName(date.getDayOfWeek()));
        JSONObject generation = repository.execute("attendance.generate", new JSONObject().put("date", date.toString()));
        String id = generation.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", id).put("status", "Present"));
        JSONObject dashboard = repository.execute("attendance.dashboard", new JSONObject());
        assertEquals(100.0, dashboard.getJSONObject("summary").getDouble("attendancePercent"), 0.0);
    }

    @Test public void foreignKeyRejectsSubjectWithoutSemester() {
        com.attenda.tracker.local.Entities.Subject subject = new com.attenda.tracker.local.Entities.Subject();
        subject.id = "orphan"; subject.semesterId = "missing"; subject.name = "Subject"; subject.code = "X";
        assertThrows(RuntimeException.class, () -> database.subjects().insert(subject));
    }

    @Test public void semestersKeepTheirOwnSubjectsAndTimetableWhenSwitching() throws Exception {
        LocalDate firstStart = LocalDate.now().plusDays(1);
        String firstEntry = seed(firstStart, dayName(firstStart.getDayOfWeek()));
        String firstSemesterId = database.semesters().current().id;

        LocalDate secondStart = firstStart.plusDays(30);
        JSONObject created = repository.execute("semester.create", new JSONObject()
                .put("name", "Second term")
                .put("startDate", secondStart.toString())
                .put("endDate", secondStart.plusDays(90).toString())
                .put("workingDays", new JSONArray().put("Monday").put("Wednesday"))
                .put("timeZone", "UTC"));
        String secondSemesterId = created.getJSONObject("semester").getString("id");

        assertEquals(2, database.semesters().all().size());
        assertEquals(secondSemesterId, database.semesters().current().id);
        assertEquals(0, repository.execute("subject.list", new JSONObject()).getJSONArray("subjects").length());
        assertNotNull(database.timetable().byId(firstEntry));

        repository.execute("semester.select", new JSONObject().put("id", firstSemesterId));
        assertEquals(firstSemesterId, database.semesters().current().id);
        assertEquals(1, repository.execute("subject.list", new JSONObject()).getJSONArray("subjects").length());
        assertEquals(2, database.semesters().all().size());
        assertNotNull(database.timetable().byId(firstEntry));
    }

    @Test public void deletingSemesterRemovesOnlyItsRecordsAndSelectsAnotherSemester() throws Exception {
        LocalDate start = LocalDate.now().plusDays(1);
        String day = dayName(start.getDayOfWeek());
        String entryId = seed(start, day);
        String firstId = database.semesters().current().id;
        repository.execute("attendance.generate", new JSONObject().put("date", start.toString()));
        LocalDate nextStart = start.plusDays(40);
        String secondId = repository.execute("semester.create", new JSONObject()
                .put("name", "Second term")
                .put("startDate", nextStart.toString())
                .put("endDate", nextStart.plusDays(80).toString())
                .put("workingDays", new JSONArray().put("Monday"))
                .put("timeZone", "UTC")).getJSONObject("semester").getString("id");

        repository.execute("semester.delete", new JSONObject().put("id", secondId));
        assertEquals(firstId, database.semesters().current().id);
        assertNotNull(database.timetable().byId(entryId));
        assertEquals(1, database.occurrences().countAll());

        repository.execute("semester.delete", new JSONObject().put("id", firstId));
        assertEquals(0, database.semesters().all().size());
        assertEquals(0, database.occurrences().countAll());
        assertEquals(0, database.changes().countAll());
    }

    private String seed(LocalDate date, String day) throws Exception {
        LocalDate end = date.plusDays(7);
        JSONArray workingDays = new JSONArray().put(day);
        repository.execute("semester.save", new JSONObject().put("name", "Test term").put("startDate", date.toString()).put("endDate", end.toString()).put("workingDays", workingDays).put("timeZone", "UTC"));
        JSONObject subject = repository.execute("subject.create", new JSONObject().put("name", "Entered subject").put("code", "SUB-1"));
        String subjectId = subject.getJSONObject("subject").getString("id");
        JSONObject entry = repository.execute("timetable.create", new JSONObject().put("subjectId", subjectId).put("day", day).put("start", "09:00").put("end", "10:00").put("room", "Room 1"));
        return entry.getJSONObject("entry").getString("id");
    }

    private static String dayName(DayOfWeek day) {
        return Arrays.asList("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday").get(day.getValue() - 1);
    }
}
