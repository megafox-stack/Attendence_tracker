package com.attenda.tracker.local;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;

import android.content.Context;
import androidx.room.Room;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
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

        JSONObject first = generateAfterClass(date);
        assertEquals(1, first.getInt("created"));
        String id = first.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", id).put("status", "Present"));

        JSONObject again = generateAfterClass(date);
        assertEquals(0, again.getInt("created"));
        assertEquals("Present", again.getJSONArray("records").getJSONObject(0).getString("status"));
    }

    @Test public void classOccurrenceIsNotGeneratedUntilItsScheduledEnd() throws Exception {
        LocalDate date = LocalDate.now(ZoneId.of("UTC")).plusDays(1);
        seed(date, dayName(date.getDayOfWeek()));

        JSONObject beforeEnd = repository.generateAt(date.toString(), date.atTime(9, 59).atZone(ZoneId.of("UTC")).toInstant());
        assertEquals(0, beforeEnd.getInt("created"));
        assertEquals(0, beforeEnd.getJSONArray("records").length());

        JSONObject afterEnd = repository.generateAt(date.toString(), date.atTime(10, 1).atZone(ZoneId.of("UTC")).toInstant());
        assertEquals(1, afterEnd.getInt("created"));
        String id = afterEnd.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", id).put("status", "Present"));

        JSONObject repeated = repository.generateAt(date.toString(), date.atTime(11, 0).atZone(ZoneId.of("UTC")).toInstant());
        assertEquals(0, repeated.getInt("created"));
        assertEquals("Present", repeated.getJSONArray("records").getJSONObject(0).getString("status"));
    }

    @Test public void nextSchedulerCheckUsesTheClassEndTime() throws Exception {
        LocalDate date = LocalDate.now(ZoneId.of("UTC")).plusDays(1);
        seed(date, dayName(date.getDayOfWeek()));
        repository.execute("scheduler.update", new JSONObject().put("enabled", true));

        long expected = date.atTime(10, 0).atZone(ZoneId.of("UTC")).toInstant().toEpochMilli();
        assertEquals(expected, repository.nextSchedulerClassEndMillis());
    }

    @Test public void sameSubjectAtTwoTimesOnSameDayGetsSeparateOccurrences() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        String day = dayName(date.getDayOfWeek());
        seed(date, day);
        String subjectId = database.subjects().bySemester(database.semesters().current().id).get(0).id;
        repository.execute("timetable.create", new JSONObject().put("subjectId", subjectId).put("day", day).put("start", "11:00").put("end", "12:00"));

        JSONObject result = generateAfterClass(date);
        assertEquals(2, result.getInt("created"));
        assertEquals(2, result.getJSONArray("records").length());
    }

    @Test public void holidayCancelsPendingRecordsWithoutDeletingTimetable() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        String day = dayName(date.getDayOfWeek());
        String entryId = seed(date, day);
        generateAfterClass(date);
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
        JSONObject generated = generateAfterClass(date);
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
        JSONObject generation = generateAfterClass(date);
        String id = generation.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", id).put("status", "Present"));
        JSONObject dashboard = repository.execute("attendance.dashboard", new JSONObject());
        assertEquals(100.0, dashboard.getJSONObject("summary").getDouble("attendancePercent"), 0.0);
    }

    @Test public void reminderCandidatesRespectActiveEntriesHolidaysAndTimetableChanges() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        String day = dayName(date.getDayOfWeek());
        String entryId = seed(date, day);
        JSONObject initial = repository.execute("notifications.reminders", new JSONObject().put("days", 14));
        assertEquals(1, initial.getJSONArray("reminders").length());

        com.attenda.tracker.local.Entities.TimetableEntry entry = database.timetable().byId(entryId);
        entry.active = false;
        database.timetable().update(entry);
        assertEquals(0, repository.execute("notifications.reminders", new JSONObject().put("days", 14)).getJSONArray("reminders").length());

        entry.active = true;
        database.timetable().update(entry);
        repository.execute("holiday.create", new JSONObject().put("date", date.toString()).put("reason", "No classes"));
        assertEquals(0, repository.execute("notifications.reminders", new JSONObject().put("days", 14)).getJSONArray("reminders").length());

        com.attenda.tracker.local.Entities.Holiday holiday = database.holidays().byDate(database.semesters().current().id, date.toString());
        database.holidays().delete(holiday.id);
        entry.start = "13:00";
        entry.end = "14:00";
        database.timetable().update(entry);
        JSONObject changed = repository.execute("notifications.reminders", new JSONObject().put("days", 14));
        assertEquals(1, changed.getJSONArray("reminders").length());
        assertEquals("13:00", changed.getJSONArray("reminders").getJSONObject(0).getString("start"));
    }

    @Test public void dailySummaryUsesPendingAndConfiguredTargetsAndIsDeduplicatedByDate() throws Exception {
        LocalDate today = LocalDate.now();
        String day = dayName(today.getDayOfWeek());
        seed(today, day);
        String subjectId = database.subjects().bySemester(database.semesters().current().id).get(0).id;
        repository.execute("subject.update", new JSONObject().put("id", subjectId).put("name", "Entered subject").put("code", "SUB-1").put("attendanceTargetPercent", 80));
        JSONObject generated = generateAfterClass(today);
        String occurrenceId = generated.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", occurrenceId).put("status", "Absent"));

        JSONObject summary = repository.execute("notifications.summary", new JSONObject());
        assertEquals(0, summary.getInt("pending"));
        assertEquals(1, summary.getInt("belowTarget"));
        assertEquals(true, summary.getBoolean("shouldNotify"));
        repository.execute("notifications.summary.markSent", new JSONObject().put("date", today.toString()));
        assertEquals(true, repository.execute("notifications.summary", new JSONObject()).getBoolean("alreadySent"));
    }

    @Test public void dailySummaryStaysSilentWhenThereIsNothingToReport() throws Exception {
        LocalDate today = LocalDate.now();
        seed(today, dayName(today.getDayOfWeek()));
        JSONObject summary = repository.execute("notifications.summary", new JSONObject());
        assertEquals(0, summary.getInt("pending"));
        assertEquals(0, summary.getInt("belowTarget"));
        assertEquals(false, summary.getBoolean("shouldNotify"));
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
        generateAfterClass(start);
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

    @Test public void manualAttendanceUsesSharedOccurrenceDatabaseAndStagedDraft() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        String day = dayName(date.getDayOfWeek());
        seed(date, day);
        String subjectId = database.subjects().bySemester(database.semesters().current().id).get(0).id;
        JSONArray staged = new JSONArray().put(new JSONObject().put("id", "manual-row-1").put("source", "manual")
                .put("subjectId", subjectId).put("date", date.toString()).put("start", "11:00").put("end", "12:00")
                .put("status", "Present").put("note", "Entered manually"));

        repository.execute("manual.draft.save", new JSONObject().put("items", staged));
        assertEquals(1, new JSONArray(repository.execute("manual.draft.get", new JSONObject()).getString("value")).length());
        JSONObject checked = repository.execute("manual.validate", new JSONObject().put("items", staged));
        assertEquals(0, checked.getJSONObject("summary").getInt("unresolved"));
        JSONObject committed = repository.execute("manual.commit", new JSONObject().put("items", staged));

        assertEquals(1, committed.getInt("created"));
        assertEquals(1, database.occurrences().countAll());
        assertEquals(1, repository.execute("attendance.history", new JSONObject()).getJSONArray("records").length());
        assertEquals(100.0, repository.execute("attendance.dashboard", new JSONObject()).getJSONObject("summary").getDouble("attendancePercent"), 0.0);
        assertEquals(0, new JSONArray(repository.execute("manual.draft.get", new JSONObject()).getString("value")).length());
        assertEquals(1, database.timetable().bySemester(database.semesters().current().id).size());
    }

    @Test public void duplicateManualRowsRequireExplicitSkipAndDoNotDuplicateOccurrence() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        seed(date, dayName(date.getDayOfWeek()));
        String subjectId = database.subjects().bySemester(database.semesters().current().id).get(0).id;
        JSONObject first = new JSONObject().put("id", "manual-a").put("source", "csv").put("subjectId", subjectId)
                .put("date", date.toString()).put("start", "11:00").put("end", "12:00").put("status", "Present");
        JSONObject duplicate = new JSONObject(first.toString()).put("id", "manual-b").put("source", "xlsx").put("status", "Absent");
        JSONArray staged = new JSONArray().put(first).put(duplicate);
        JSONObject validation = repository.execute("manual.validate", new JSONObject().put("items", staged));
        assertEquals(1, validation.getJSONObject("summary").getInt("duplicates"));
        assertEquals(1, validation.getJSONObject("summary").getInt("unresolved"));
        duplicate.put("decision", "skip");
        JSONObject result = repository.execute("manual.commit", new JSONObject().put("items", staged));
        assertEquals(1, result.getInt("created"));
        assertEquals(1, result.getInt("skipped"));
        assertEquals(1, database.occurrences().countAll());
    }

    @Test public void manualConflictRequiresChoiceAndReplacementKeepsSingleRecord() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        String day = dayName(date.getDayOfWeek());
        String entryId = seed(date, day);
        JSONObject generated = generateAfterClass(date);
        String occurrenceId = generated.getJSONArray("records").getJSONObject(0).getString("id");
        repository.execute("attendance.update", new JSONObject().put("id", occurrenceId).put("status", "Absent"));
        String subjectId = database.timetable().byId(entryId).subjectId;
        JSONObject row = new JSONObject().put("id", "manual-conflict").put("source", "manual").put("subjectId", subjectId)
                .put("date", date.toString()).put("start", "09:00").put("end", "10:00").put("status", "Present");
        JSONArray staged = new JSONArray().put(row);
        assertEquals(1, repository.execute("manual.validate", new JSONObject().put("items", staged)).getJSONObject("summary").getInt("unresolved"));
        row.put("decision", "replace");
        JSONObject result = repository.execute("manual.commit", new JSONObject().put("items", staged));
        assertEquals(1, result.getInt("updated"));
        assertEquals(1, database.occurrences().countAll());
        assertEquals("Present", repository.execute("attendance.classes", new JSONObject().put("date", date.toString())).getJSONArray("records").getJSONObject(0).getString("status"));
        assertEquals(0, generateAfterClass(date).getInt("created"));
        assertEquals("Present", database.occurrences().byId(occurrenceId).status);
    }

    @Test public void invalidManualBatchRollsBackAllRowsAndKeepsDraft() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        seed(date, dayName(date.getDayOfWeek()));
        String subjectId = database.subjects().bySemester(database.semesters().current().id).get(0).id;
        JSONObject valid = new JSONObject().put("id", "manual-valid").put("source", "manual").put("subjectId", subjectId)
                .put("date", date.toString()).put("start", "11:00").put("end", "12:00").put("status", "Present");
        JSONObject invalid = new JSONObject().put("id", "manual-invalid").put("source", "csv").put("subjectId", "missing-subject")
                .put("date", date.toString()).put("start", "12:00").put("end", "13:00").put("status", "Absent");
        JSONArray staged = new JSONArray().put(valid).put(invalid);
        repository.execute("manual.draft.save", new JSONObject().put("items", staged));
        assertThrows(IllegalArgumentException.class, () -> repository.execute("manual.commit", new JSONObject().put("items", staged)));
        assertEquals(0, database.occurrences().countAll());
        assertEquals(2, new JSONArray(repository.execute("manual.draft.get", new JSONObject()).getString("value")).length());
    }

    @Test public void manualHolidayIsCalendarEventAndCancelsOnlyPendingOccurrences() throws Exception {
        LocalDate date = LocalDate.now().plusDays(2);
        String day = dayName(date.getDayOfWeek());
        seed(date, day);
        generateAfterClass(date);
        JSONObject holiday = new JSONObject().put("id", "holiday-row").put("source", "manual").put("date", date.toString())
                .put("status", "Holiday").put("note", "Campus closed");
        JSONArray staged = new JSONArray().put(holiday);
        JSONObject analysis = repository.execute("manual.validate", new JSONObject().put("items", staged));
        assertEquals(1, analysis.getJSONObject("summary").getInt("unresolved"));
        holiday.put("decision", "apply");
        JSONObject result = repository.execute("manual.commit", new JSONObject().put("items", staged));
        assertEquals(1, result.getInt("holidaysCreated"));
        assertEquals(1, result.getInt("pendingCancelledByHoliday"));
        assertEquals("CANCELLED", database.occurrences().recent().get(0).status);
        assertEquals(1, database.holidays().bySemester(database.semesters().current().id).size());
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

    private JSONObject generateAfterClass(LocalDate date) throws Exception {
        Instant afterClass = date.atTime(13, 0).atZone(ZoneId.of("UTC")).toInstant();
        return repository.generateAt(date.toString(), afterClass);
    }

    private static String dayName(DayOfWeek day) {
        return Arrays.asList("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday").get(day.getValue() - 1);
    }
}
