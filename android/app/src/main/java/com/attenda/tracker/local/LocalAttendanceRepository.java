package com.attenda.tracker.local;

import android.content.Context;
import androidx.room.Room;
import com.attenda.tracker.local.Entities.AppSetting;
import com.attenda.tracker.local.Entities.AttendanceChange;
import com.attenda.tracker.local.Entities.ClassOccurrence;
import com.attenda.tracker.local.Entities.Holiday;
import com.attenda.tracker.local.Entities.Semester;
import com.attenda.tracker.local.Entities.Subject;
import com.attenda.tracker.local.Entities.TimetableEntry;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** All Room work is invoked by LocalAttendancePlugin on a dedicated executor. */
public final class LocalAttendanceRepository {
    private static final String[] DAYS = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    private static final String[] STATUSES = {"PENDING", "PRESENT", "ABSENT", "CANCELLED"};
    private static volatile AttendanceDatabase instance;
    private final AttendanceDatabase db;

    public static AttendanceDatabase database(Context context) {
        if (instance == null) {
            synchronized (LocalAttendanceRepository.class) {
                if (instance == null) instance = Room.databaseBuilder(context.getApplicationContext(), AttendanceDatabase.class, "attendance-tracker.db").build();
            }
        }
        return instance;
    }

    public LocalAttendanceRepository(Context context) { db = database(context); }
    public LocalAttendanceRepository(AttendanceDatabase database) { db = database; }

    public JSONObject execute(String action, JSONObject p) throws Exception {
        JSONObject result;
        switch (action) {
            case "health": result = new JSONObject().put("status", "ready").put("database", "local"); break;
            case "semester.getCurrent": result = new JSONObject().put("semester", semesterJson(db.semesters().current())); break;
            case "semester.list": result = semesterList(); break;
            case "semester.save": result = saveSemester(p); break;
            case "semester.create": result = createSemester(p); break;
            case "semester.select": result = selectSemester(required(p, "id")); break;
            case "semester.delete": result = deleteSemester(required(p, "id")); break;
            case "subject.list": result = new JSONObject().put("subjects", subjectArray()); break;
            case "subject.create": result = new JSONObject().put("subject", saveSubject(null, p)); break;
            case "subject.update": result = new JSONObject().put("subject", saveSubject(required(p, "id"), p)); break;
            case "subject.delete": result = deleteSubject(required(p, "id")); break;
            case "timetable.get": result = timetableJson(); break;
            case "timetable.create": result = new JSONObject().put("entry", saveEntry(null, p)); break;
            case "timetable.update": result = new JSONObject().put("entry", saveEntry(required(p, "id"), p)); break;
            case "timetable.active": result = setEntryActive(required(p, "id"), p.optBoolean("active", false)); break;
            case "timetable.delete": result = deleteEntry(required(p, "id")); break;
            case "holiday.create": result = createHoliday(p); break;
            case "holiday.delete": result = deleteHoliday(required(p, "id")); break;
            case "attendance.classes": result = new JSONObject().put("date", required(p, "date")).put("records", occurrencesArray(db.occurrences().byDate(required(p, "date")))); break;
            case "attendance.generate": result = generate(required(p, "date")); break;
            case "attendance.history": result = history(p); break;
            case "attendance.update": result = updateOccurrence(required(p, "id"), p); break;
            case "attendance.delete": result = deleteOccurrence(required(p, "id")); break;
            case "attendance.bulk": result = applyChanges(required(p, "date"), p.optJSONArray("changes")); break;
            case "attendance.submit": result = submitDay(required(p, "date"), p.optJSONArray("changes")); break;
            case "attendance.dashboard": result = dashboard(); break;
            case "attendance.subjects": result = new JSONObject().put("subjects", attendanceSubjects(null)); break;
            case "attendance.insights": result = insights(p); break;
            case "attendance.reset": result = resetAttendance(); break;
            case "scheduler.status": result = schedulerStatus(); break;
            case "scheduler.update": result = updateScheduler(p.optBoolean("enabled", false)); break;
            case "settings.get": result = getSetting(required(p, "key")); break;
            case "settings.save": result = saveSetting(p); break;
            case "settings.delete": result = deleteSetting(required(p, "key")); break;
            case "notifications.settings.get": result = notificationSettings(); break;
            case "notifications.settings.save": result = saveNotificationSettings(p); break;
            case "notifications.summary": result = notificationSummary(); break;
            case "notifications.summary.markSent": result = markNotificationSummarySent(required(p, "date")); break;
            case "notifications.reminders": result = notificationReminders(p.optInt("days", 14)); break;
            case "notifications.classReminder": result = classReminder(p); break;
            case "backup.snapshot": result = backupSnapshot(); break;
            case "backup.restore": result = restoreBackup(p); break;
            default: throw new IllegalArgumentException("Unsupported local data operation: " + action);
        }
        return result;
    }

    private JSONObject saveSemester(JSONObject p) throws Exception {
        Semester old = db.semesters().current();
        Semester s = old == null ? new Semester() : old;
        if (s.id.isEmpty()) s.id = uuid();
        applySemesterFields(s, p);
        if (old == null) s.status = "active";
        transaction(() -> {
            if (old == null) db.semesters().insert(s); else {
                db.semesters().update(s);
                db.timetable().updateEffectiveDates(s.id, s.startDate, s.endDate);
            }
        });
        return new JSONObject().put("semester", semesterJson(s));
    }

    private void applySemesterFields(Semester semester, JSONObject payload) throws Exception {
        String name = text(payload, "name").trim();
        String start = validDate(text(payload, "startDate"), "semester start date");
        String end = validDate(text(payload, "endDate"), "semester end date");
        if (end.compareTo(start) < 0) throw new IllegalArgumentException("Semester end date must be on or after its start date.");
        if (name.isEmpty() || name.length() > 120) throw new IllegalArgumentException("Semester name is required and must be at most 120 characters.");
        JSONArray dayList = payload.optJSONArray("workingDays");
        if (dayList == null || dayList.length() == 0) throw new IllegalArgumentException("Choose at least one working day.");
        int mask = 0; Set<String> unique = new HashSet<>();
        for (int i = 0; i < dayList.length(); i++) {
            String day = dayList.getString(i); int index = dayIndex(day);
            if (!unique.add(day)) throw new IllegalArgumentException("Working days cannot contain duplicates.");
            mask |= 1 << index;
        }
        Double target = nullableDouble(payload, "attendanceTargetPercent"); validateTarget(target);
        semester.name = name; semester.startDate = start; semester.endDate = end;
        semester.workingDaysMask = mask; semester.attendanceTargetPercent = target;
        semester.timeZone = validZone(payload.optString("timeZone", ZoneId.systemDefault().getId()));
    }

    private JSONObject createSemester(JSONObject payload) throws Exception {
        Semester semester = new Semester(); semester.id = uuid(); semester.status = "active";
        applySemesterFields(semester, payload);
        transaction(() -> {
            for (Semester existing : db.semesters().all()) if ("active".equals(existing.status)) { existing.status = "draft"; db.semesters().update(existing); }
            db.semesters().insert(semester);
        });
        return new JSONObject().put("semester", semesterJson(semester));
    }

    private JSONObject selectSemester(String id) throws Exception {
        Semester selected = db.semesters().byId(id);
        if (selected == null) throw new IllegalArgumentException("Semester not found.");
        transaction(() -> {
            for (Semester semester : db.semesters().all()) {
                String nextStatus = semester.id.equals(id) ? "active" : ("active".equals(semester.status) ? "draft" : semester.status);
                if (!nextStatus.equals(semester.status)) { semester.status = nextStatus; db.semesters().update(semester); }
            }
        });
        return new JSONObject().put("semester", semesterJson(db.semesters().byId(id)));
    }

    private JSONObject semesterList() throws Exception {
        JSONArray semesters = new JSONArray();
        for (Semester semester : db.semesters().all()) semesters.put(semesterJson(semester));
        Semester current = db.semesters().current();
        return new JSONObject().put("semesters", semesters).put("currentId", current == null ? JSONObject.NULL : current.id);
    }

    private JSONObject deleteSemester(String id) throws Exception {
        Semester target = db.semesters().byId(id);
        if (target == null) throw new IllegalArgumentException("Semester not found.");
        Semester current = db.semesters().current();
        boolean wasCurrent = current != null && target.id.equals(current.id);
        transaction(() -> {
            db.occurrences().deleteBySemester(id);
            for (Holiday holiday : db.holidays().bySemester(id)) db.holidays().delete(holiday.id);
            db.timetable().deleteBySemester(id);
            db.subjects().deleteBySemester(id);
            db.semesters().delete(id);
            if (wasCurrent) {
                List<Semester> remaining = db.semesters().all();
                if (!remaining.isEmpty()) {
                    Semester next = remaining.get(0); next.status = "active"; db.semesters().update(next);
                }
            }
        });
        return new JSONObject().put("deletedId", id).put("deletedActiveSemester", wasCurrent);
    }

    private JSONObject saveSubject(String id, JSONObject p) throws Exception {
        Semester semester = requireCurrentSemester();
        String name = text(p, "name").trim(); String code = text(p, "code").trim().toUpperCase(Locale.ROOT);
        Double target = nullableDouble(p, "attendanceTargetPercent"); validateTarget(target);
        if (name.isEmpty() || name.length() > 160) throw new IllegalArgumentException("Subject name is required and must be at most 160 characters.");
        if (code.isEmpty() || code.length() > 40) throw new IllegalArgumentException("Subject code is required and must be at most 40 characters.");
        Subject s = id == null ? new Subject() : db.subjects().byId(id);
        if (s == null) throw new IllegalArgumentException("Subject not found.");
        for (Subject existing : db.subjects().bySemester(semester.id)) if (!existing.id.equals(s.id) && existing.code.equalsIgnoreCase(code)) throw new IllegalArgumentException("A subject with that code already exists in this semester.");
        boolean insert = id == null;
        if (insert) { s.id = uuid(); s.semesterId = semester.id; s.active = true; }
        s.name = name; s.code = code; s.attendanceTargetPercent = target;
        if (insert) db.subjects().insert(s); else db.subjects().update(s);
        return subjectJson(s);
    }

    private JSONObject deleteSubject(String id) throws Exception {
        if (db.subjects().byId(id) == null) throw new IllegalArgumentException("Subject not found.");
        if (db.subjects().entryCount(id) > 0 || db.subjects().occurrenceCount(id) > 0) throw new IllegalArgumentException("This subject is used by timetable entries. Remove or reassign those entries before deleting it.");
        if (db.subjects().delete(id) == 0) throw new IllegalArgumentException("Subject not found.");
        return new JSONObject();
    }

    private JSONObject timetableJson() throws Exception {
        Semester s = db.semesters().current();
        JSONArray entries = new JSONArray(); JSONArray holidays = new JSONArray();
        if (s != null) {
            for (TimetableEntry e : db.timetable().bySemester(s.id)) entries.put(entryJson(e));
            for (Holiday h : db.holidays().bySemester(s.id)) holidays.put(holidayJson(h));
        }
        return new JSONObject().put("semester", semesterJson(s)).put("entries", entries).put("holidays", holidays);
    }

    private JSONObject saveEntry(String id, JSONObject p) throws Exception {
        Semester semester = requireCurrentSemester();
        String subjectId = text(p, "subjectId"); Subject subject = db.subjects().byId(subjectId);
        if (subject == null || !subject.semesterId.equals(semester.id) || !subject.active) throw new IllegalArgumentException("Choose an active subject from your current semester.");
        String dayValue = text(p, "day"); int dayIndex = dayIndex(dayValue);
        if ((semester.workingDaysMask & (1 << dayIndex)) == 0) throw new IllegalArgumentException("This day is not enabled as a semester working day.");
        String start = validTime(text(p, "start")); String end = validTime(text(p, "end"));
        if (end.compareTo(start) <= 0) throw new IllegalArgumentException("Class end time must be later than its start time.");
        String room = p.optString("room", "").trim(); if (room.length() > 120) throw new IllegalArgumentException("Room or laboratory must be 120 characters or fewer.");
        TimetableEntry entry = id == null ? new TimetableEntry() : db.timetable().byId(id);
        if (entry == null || (id != null && !entry.semesterId.equals(semester.id))) throw new IllegalArgumentException("Timetable entry not found.");
        boolean active = p.has("active") ? p.optBoolean("active") : id == null || entry.active;
        if (active && db.timetable().overlap(semester.id, dayName(dayIndex), start, end, id) != null) throw new IllegalArgumentException("This class overlaps another active entry on that day.");
        boolean insert = id == null;
        if (insert) { entry.id = uuid(); entry.semesterId = semester.id; }
        entry.subjectId = subjectId; entry.day = dayName(dayIndex); entry.start = start; entry.end = end;
        entry.room = room.isEmpty() ? null : room; entry.effectiveFrom = semester.startDate; entry.effectiveUntil = semester.endDate; entry.active = active;
        if (insert) db.timetable().insert(entry); else db.timetable().update(entry);
        return entryJson(entry);
    }

    private JSONObject setEntryActive(String id, boolean active) throws Exception {
        TimetableEntry e = db.timetable().byId(id); if (e == null) throw new IllegalArgumentException("Timetable entry not found.");
        if (active && db.timetable().overlap(e.semesterId, e.day, e.start, e.end, id) != null) throw new IllegalArgumentException("This class overlaps another active entry on that day.");
        e.active = active; db.timetable().update(e);
        return new JSONObject().put("id", e.id).put("active", e.active);
    }

    private JSONObject deleteEntry(String id) throws Exception {
        TimetableEntry e = db.timetable().byId(id); if (e == null) throw new IllegalArgumentException("Timetable entry not found.");
        boolean preserved = db.timetable().occurrenceCount(id) > 0;
        if (preserved) { e.active = false; db.timetable().update(e); } else db.timetable().delete(id);
        return new JSONObject().put("preservedRecords", preserved);
    }

    private JSONObject createHoliday(JSONObject p) throws Exception {
        Semester s = requireCurrentSemester(); String date = text(p, "date"); validDate(date, "holiday date");
        String reason = p.optString("reason", "").trim(); if (reason.length() > 240) throw new IllegalArgumentException("Holiday reason must be 240 characters or fewer.");
        if (date.compareTo(s.startDate) < 0 || date.compareTo(s.endDate) > 0) throw new IllegalArgumentException("Holiday date must fall within the current semester.");
        Holiday existing = db.holidays().byDate(s.id, date); if (existing != null) throw new IllegalArgumentException("A holiday already exists on this date.");
        final int[] cancelled = {0};
        transaction(() -> {
            Holiday holiday = new Holiday(); holiday.id = uuid(); holiday.semesterId = s.id; holiday.date = date; holiday.reason = reason.isEmpty() ? null : reason;
            db.holidays().insert(holiday);
            long now = System.currentTimeMillis();
            for (ClassOccurrence record : db.occurrences().byDate(date)) {
                if (record.semesterId.equals(s.id) && "PENDING".equals(record.status)) {
                    AttendanceChange audit = change(record, "CANCELLED", reason.isEmpty() ? "Holiday configured for this class date." : ("Holiday: " + reason).substring(0, Math.min(500, reason.length() + 9)), now);
                    audit.actorType = "system"; db.changes().insert(audit);
                    record.status = "CANCELLED"; record.finalizedAt = now; db.occurrences().update(record); cancelled[0]++;
                }
            }
        });
        return new JSONObject().put("holiday", holidayJson(db.holidays().byDate(s.id, date))).put("pendingRecordsCancelled", cancelled[0]);
    }

    private JSONObject deleteHoliday(String id) throws Exception {
        if (db.holidays().delete(id) == 0) throw new IllegalArgumentException("Holiday not found.");
        return new JSONObject();
    }

    private JSONObject generate(String date) throws Exception {
        validDate(date, "class date"); Semester s = requireCurrentSemester();
        if (date.compareTo(s.startDate) < 0 || date.compareTo(s.endDate) > 0) throw new IllegalArgumentException("The selected date is outside the current semester.");
        String today = LocalDate.now(ZoneId.of(s.timeZone)).toString();
        if (date.compareTo(today) < 0) throw new IllegalArgumentException("Historical records are never inferred from the recurring timetable.");
        int weekday = LocalDate.parse(date).getDayOfWeek().getValue();
        if ((s.workingDaysMask & (1 << (weekday - 1))) == 0) throw new IllegalArgumentException("The selected date is not a configured working day.");
        if (db.holidays().byDate(s.id, date) != null) return new JSONObject().put("date", date).put("created", 0).put("skipped", "holiday").put("records", occurrencesJson(db.occurrences().byDate(date)));
        final int[] inserted = {0}; final long now = System.currentTimeMillis();
        transaction(() -> {
            for (TimetableEntry entry : db.timetable().bySemester(s.id)) {
                if (!entry.active || !entry.day.equals(dayName(weekday - 1)) || date.compareTo(entry.effectiveFrom) < 0 || date.compareTo(entry.effectiveUntil) > 0) continue;
                Subject subject = db.subjects().byId(entry.subjectId); if (subject == null || !subject.active) continue;
                ClassOccurrence occurrence = new ClassOccurrence(); occurrence.id = uuid(); occurrence.semesterId = s.id; occurrence.timetableEntryId = entry.id;
                occurrence.subjectId = subject.id; occurrence.classDate = date; occurrence.start = entry.start; occurrence.end = entry.end;
                occurrence.subjectNameSnapshot = subject.name; occurrence.subjectCodeSnapshot = subject.code; occurrence.roomSnapshot = entry.room;
                occurrence.status = "PENDING"; occurrence.generatedAt = now;
                if (db.occurrences().insertIgnore(occurrence) != -1) inserted[0]++;
            }
        });
        return new JSONObject().put("date", date).put("created", inserted[0]).put("skipped", JSONObject.NULL).put("records", occurrencesJson(db.occurrences().byDate(date)));
    }

    private JSONObject updateOccurrence(String id, JSONObject p) throws Exception {
        String status = normalizeStatus(text(p, "status"));
        String reason = p.optString("reason", p.optString("note", "")).trim();
        boolean updateNote = p.has("reason") || p.has("note");
        if (reason.length() > 500) throw new IllegalArgumentException("Correction reason must be 500 characters or fewer.");
        ClassOccurrence record = db.occurrences().byId(id); if (record == null) throw new IllegalArgumentException("Attendance record not found.");
        transaction(() -> applyOne(record, status, reason, updateNote));
        return new JSONObject().put("date", record.classDate).put("records", occurrencesJson(db.occurrences().byDate(record.classDate)));
    }

    private JSONObject deleteOccurrence(String id) throws Exception {
        ClassOccurrence record = db.occurrences().byId(id);
        if (record == null) throw new IllegalArgumentException("Attendance record not found.");
        transaction(() -> db.occurrences().delete(id));
        return new JSONObject().put("deleted", true).put("id", id).put("date", record.classDate);
    }

    private JSONObject applyChanges(String date, JSONArray changes) throws Exception {
        validDate(date, "class date"); if (changes == null || changes.length() > 100) throw new IllegalArgumentException("Submit between 1 and 100 attendance changes.");
        Set<String> ids = new HashSet<>(); final int[] changed = {0};
        transaction(() -> {
            for (int i = 0; i < changes.length(); i++) {
                JSONObject item = changes.getJSONObject(i); String id = required(item, "id");
                if (!ids.add(id)) throw new IllegalArgumentException("Each attendance record must have one unique ID.");
                ClassOccurrence record = db.occurrences().byId(id);
                if (record == null || !record.classDate.equals(date)) throw new IllegalArgumentException("An attendance record does not belong to this date.");
                String status = normalizeStatus(required(item, "status")); String reason = item.optString("reason", "").trim();
                if (reason.length() > 500) throw new IllegalArgumentException("Correction reason must be 500 characters or fewer.");
                if (applyOne(record, status, reason, item.has("reason") || item.has("note"))) changed[0]++;
            }
        });
        return new JSONObject().put("date", date).put("changed", changed[0]).put("records", occurrencesJson(db.occurrences().byDate(date)));
    }

    private JSONObject submitDay(String date, JSONArray changes) throws Exception {
        JSONObject result = applyChanges(date, changes);
        result.put("saved", true);
        return result;
    }

    private boolean applyOne(ClassOccurrence record, String status, String reason, boolean updateNote) {
        String old = record.status;
        if (old.equals(status)) {
            String newNote = reason.isEmpty() ? null : reason;
            if (updateNote && !java.util.Objects.equals(newNote, record.note)) { record.note = newNote; db.occurrences().update(record); return true; }
            return false;
        }
        long now = System.currentTimeMillis();
        db.changes().insert(change(record, status, reason.isEmpty() ? null : reason, now));
        record.status = status; if (updateNote) record.note = reason.isEmpty() ? null : reason; record.finalizedAt = "PENDING".equals(status) ? null : now;
        db.occurrences().update(record); return true;
    }

    private AttendanceChange change(ClassOccurrence record, String status, String reason, long now) {
        AttendanceChange change = new AttendanceChange(); change.id = uuid(); change.occurrenceId = record.id;
        change.oldStatus = record.status; change.newStatus = status; change.reason = reason; change.changedAt = now; return change;
    }

    private JSONObject dashboard() throws Exception {
        // Dashboard totals are not capped, unlike the history screen.
        List<ClassOccurrence> dashboardRecords = getAllOccurrences();
        JSONObject summary = countSummary(dashboardRecords, false);
        Semester s = db.semesters().current(); String today = LocalDate.now(ZoneId.of(s == null ? ZoneId.systemDefault().getId() : s.timeZone)).toString();
        List<ClassOccurrence> todays = db.occurrences().byDate(today);
        JSONArray records = occurrencesJson(todays); JSONObject next = null;
        int minuteNow = LocalTime.now(ZoneId.of(s == null ? ZoneId.systemDefault().getId() : s.timeZone)).getHour() * 60 + LocalTime.now(ZoneId.of(s == null ? ZoneId.systemDefault().getId() : s.timeZone)).getMinute();
        for (ClassOccurrence r : todays) if (!"CANCELLED".equals(r.status) && timeMinutes(r.end) > minuteNow) { next = occurrenceJson(r); break; }
        return new JSONObject().put("date", today).put("summary", summary).put("todayRecords", records).put("nextClass", next == null ? JSONObject.NULL : next);
    }

    private JSONObject history(JSONObject p) throws Exception {
        String query = p.optString("query", ""); String subjectQuery = p.optString("subject", query).trim().toLowerCase(Locale.ROOT);
        String status = p.optString("status", "All statuses"); String from = p.optString("from", ""); String to = p.optString("to", "");
        if (!from.isEmpty()) validDate(from, "start date"); if (!to.isEmpty()) validDate(to, "end date");
        if (!from.isEmpty() && !to.isEmpty() && from.compareTo(to) > 0) throw new IllegalArgumentException("Start date must be before end date.");
        JSONArray records = new JSONArray(); List<ClassOccurrence> all = getAllOccurrences();
        all.sort(Comparator.comparing((ClassOccurrence o) -> o.classDate).thenComparing(o -> o.start).reversed());
        for (ClassOccurrence r : all) {
            if (!subjectQuery.isEmpty() && !(r.subjectNameSnapshot.toLowerCase(Locale.ROOT).contains(subjectQuery) || r.subjectCodeSnapshot.toLowerCase(Locale.ROOT).contains(subjectQuery))) continue;
            if (!"All statuses".equals(status) && !r.status.equals(normalizeStatus(status))) continue;
            if (!from.isEmpty() && r.classDate.compareTo(from) < 0 || !to.isEmpty() && r.classDate.compareTo(to) > 0) continue;
            records.put(occurrenceJson(r)); if (records.length() == 500) break;
        }
        return new JSONObject().put("records", records);
    }

    private JSONObject insights(JSONObject p) throws Exception {
        String from = p.optString("from", ""); String to = p.optString("to", ""); String range = p.optString("range", "");
        if (!from.isEmpty()) validDate(from, "start date"); if (!to.isEmpty()) validDate(to, "end date");
        Semester s = db.semesters().current();
        boolean emptySemesterRange = "semester".equals(range) && s == null;
        if ("semester".equals(range) && s != null) { from = later(from, s.startDate); to = earlier(to, s.endDate); }
        List<ClassOccurrence> records = new ArrayList<>();
        if (!emptySemesterRange) for (ClassOccurrence r : getAllOccurrences()) if ((from.isEmpty() || r.classDate.compareTo(from) >= 0) && (to.isEmpty() || r.classDate.compareTo(to) <= 0)) records.add(r);
        JSONObject summary = countSummary(records, false); JSONArray trend = new JSONArray();
        java.util.Map<String, int[]> days = new java.util.TreeMap<>();
        for (ClassOccurrence r : records) { int[] pair = days.computeIfAbsent(r.classDate, ignored -> new int[2]); if ("PRESENT".equals(r.status)) pair[0]++; if ("ABSENT".equals(r.status)) pair[1]++; }
        for (java.util.Map.Entry<String, int[]> e : days.entrySet()) if (e.getValue()[0] + e.getValue()[1] > 0) trend.put(new JSONObject().put("date", e.getKey()).put("present", e.getValue()[0]).put("absent", e.getValue()[1]));
        JSONArray subjects = attendanceSubjects(records);
        return new JSONObject().put("summary", summary).put("trend", trend).put("subjects", subjects);
    }

    private JSONArray attendanceSubjects(List<ClassOccurrence> subset) throws Exception {
        Semester semester = db.semesters().current(); JSONArray result = new JSONArray(); if (semester == null) return result;
        for (Subject subject : db.subjects().bySemester(semester.id)) {
            if (!subject.active) continue;
            List<ClassOccurrence> rows = subset == null ? db.occurrences().bySubject(subject.id) : subsetFor(subset, subject.id);
            int present = 0, absent = 0, pending = 0, cancelled = 0;
            for (ClassOccurrence r : rows) { switch (r.status) { case "PRESENT": present++; break; case "ABSENT": absent++; break; case "PENDING": pending++; break; case "CANCELLED": cancelled++; break; default: break; } }
            Double target = subject.attendanceTargetPercent == null ? semester.attendanceTargetPercent : subject.attendanceTargetPercent;
            result.put(new JSONObject().put("id", subject.id).put("name", subject.name).put("code", subject.code).put("targetPercent", target == null ? JSONObject.NULL : target).put("present", present).put("absent", absent).put("pending", pending).put("cancelled", cancelled).put("attendancePercent", percent(present, absent)));
        }
        return result;
    }

    private JSONObject resetAttendance() throws Exception {
        final int[] counts = new int[2];
        transaction(() -> { counts[0] = db.occurrences().countAll(); counts[1] = db.changes().countAll(); db.occurrences().deleteAll(); db.changes().deleteAll(); });
        return new JSONObject().put("deletedRecords", counts[0]).put("deletedChanges", counts[1]);
    }

    private JSONObject schedulerStatus() throws Exception {
        boolean enabled = "true".equalsIgnoreCase(db.settings().get("schedulerEnabled"));
        String last = db.settings().get("schedulerLastRunAt"); String error = db.settings().get("schedulerLastError"); if (error != null && error.trim().isEmpty()) error = null;
        Semester semester = db.semesters().current(); boolean configured = false;
        if (semester != null) for (TimetableEntry entry : db.timetable().bySemester(semester.id)) if (entry.active) { Subject subject = db.subjects().byId(entry.subjectId); if (subject != null && subject.active) { configured = true; break; } }
        String status = enabled ? (error == null ? (configured ? "active" : "setup_required") : "error") : (configured ? "disabled" : "not_configured");
        JSONObject result = new JSONObject().put("enabled", enabled).put("configured", configured).put("status", status).put("lastRunAt", last == null ? JSONObject.NULL : last).put("lastRunDate", db.settings().get("schedulerLastRunDate") == null ? JSONObject.NULL : db.settings().get("schedulerLastRunDate")).put("lastError", error == null ? JSONObject.NULL : error).put("nextRun", enabled ? "Scheduled by Android WorkManager; system may delay execution." : JSONObject.NULL);
        return new JSONObject().put("scheduler", result);
    }

    private JSONObject updateScheduler(boolean enabled) throws Exception {
        JSONObject status = schedulerStatus().getJSONObject("scheduler");
        if (enabled && !status.optBoolean("configured")) throw new IllegalArgumentException("Configure a semester and active weekly class before enabling the scheduler.");
        transaction(() -> {
            putSetting("schedulerEnabled", Boolean.toString(enabled)); putSetting("schedulerLastError", "");
            if (enabled) putSetting("schedulerLastRunDate", "");
        });
        JSONObject result = schedulerStatus().getJSONObject("scheduler");
        return new JSONObject().put("scheduler", result);
    }

    private JSONObject getSetting(String key) throws Exception {
        validateSettingKey(key);
        String value = db.settings().get(key);
        return new JSONObject().put("key", key).put("value", value == null ? JSONObject.NULL : value);
    }

    private JSONObject saveSetting(JSONObject payload) throws Exception {
        String key = required(payload, "key"); validateSettingKey(key);
        String value = payload.optString("value", "");
        if (value.length() > 2000) throw new IllegalArgumentException("Setting value must be 2000 characters or fewer.");
        putSetting(key, value);
        return getSetting(key);
    }

    private JSONObject deleteSetting(String key) throws Exception {
        validateSettingKey(key);
        return new JSONObject().put("deleted", db.settings().delete(key) > 0);
    }

    private JSONObject notificationSettings() throws Exception {
        return new JSONObject()
                .put("classReminders", "true".equalsIgnoreCase(db.settings().get("notificationClassReminders")))
                .put("dailySummary", "true".equalsIgnoreCase(db.settings().get("notificationDailySummary")));
    }

    private JSONObject saveNotificationSettings(JSONObject payload) throws Exception {
        boolean classReminders = payload.optBoolean("classReminders", false);
        boolean dailySummary = payload.optBoolean("dailySummary", false);
        transaction(() -> {
            putSetting("notificationClassReminders", Boolean.toString(classReminders));
            putSetting("notificationDailySummary", Boolean.toString(dailySummary));
        });
        return notificationSettings();
    }

    private JSONObject notificationSummary() throws Exception {
        Semester semester = db.semesters().current();
        if (semester == null) return new JSONObject().put("date", JSONObject.NULL).put("pending", 0).put("belowTarget", 0).put("shouldNotify", false);
        ZoneId zone = ZoneId.of(semester.timeZone);
        String today = LocalDate.now(zone).toString();
        int pending = 0;
        for (ClassOccurrence record : db.occurrences().byDate(today)) if (semester.id.equals(record.semesterId) && "PENDING".equals(record.status)) pending++;
        int belowTarget = 0;
        JSONArray subjects = attendanceSubjects(null);
        for (int i = 0; i < subjects.length(); i++) {
            JSONObject subject = subjects.getJSONObject(i);
            if (!subject.isNull("targetPercent") && !subject.isNull("attendancePercent") && subject.getDouble("attendancePercent") < subject.getDouble("targetPercent")) belowTarget++;
        }
        boolean alreadySent = today.equals(db.settings().get("notificationDailySummaryLastDate"));
        return new JSONObject().put("date", today).put("pending", pending).put("belowTarget", belowTarget).put("alreadySent", alreadySent).put("shouldNotify", pending > 0 || belowTarget > 0);
    }

    private JSONObject markNotificationSummarySent(String date) throws Exception {
        validDate(date, "notification date");
        String currentDate = notificationSummary().optString("date", "");
        if (!date.equals(currentDate)) return new JSONObject().put("marked", false);
        putSetting("notificationDailySummaryLastDate", date);
        return new JSONObject().put("marked", true);
    }

    private JSONArray notificationReminders(int horizonDays) throws Exception {
        JSONArray reminders = new JSONArray();
        Semester semester = db.semesters().current();
        if (semester == null || horizonDays < 1 || horizonDays > 31) return reminders;
        ZoneId zone = ZoneId.of(semester.timeZone);
        LocalDate today = LocalDate.now(zone);
        LocalDate lastDate = today.plusDays(horizonDays);
        if (lastDate.isAfter(LocalDate.parse(semester.endDate))) lastDate = LocalDate.parse(semester.endDate);
        List<TimetableEntry> entries = db.timetable().bySemester(semester.id);
        for (LocalDate date = today; !date.isAfter(lastDate); date = date.plusDays(1)) {
            if (date.isBefore(LocalDate.parse(semester.startDate)) || (semester.workingDaysMask & (1 << (date.getDayOfWeek().getValue() - 1))) == 0) continue;
            if (db.holidays().byDate(semester.id, date.toString()) != null) continue;
            for (TimetableEntry entry : entries) {
                if (!entry.active || entry.historicalOnly || !entry.day.equals(dayName(date.getDayOfWeek().getValue() - 1))) continue;
                if (date.toString().compareTo(entry.effectiveFrom) < 0 || date.toString().compareTo(entry.effectiveUntil) > 0) continue;
                java.time.Instant fireAt = LocalDate.parse(date.toString()).atTime(LocalTime.parse(entry.start)).atZone(zone).minusMinutes(10).toInstant();
                if (!fireAt.isAfter(java.time.Instant.now())) continue;
                Subject subject = db.subjects().byId(entry.subjectId);
                if (subject == null || !subject.active) continue;
                reminders.put(new JSONObject().put("entryId", entry.id).put("semesterId", semester.id).put("date", date.toString()).put("fireAt", fireAt.toEpochMilli()).put("subject", subject.name).put("code", subject.code).put("start", entry.start).put("room", entry.room == null ? JSONObject.NULL : entry.room));
            }
        }
        return reminders;
    }

    private JSONObject classReminder(JSONObject payload) throws Exception {
        String entryId = required(payload, "entryId");
        String semesterId = required(payload, "semesterId");
        String date = validDate(required(payload, "date"), "class date");
        Semester semester = db.semesters().current();
        if (semester == null || !semester.id.equals(semesterId)) return new JSONObject().put("valid", false);
        TimetableEntry entry = db.timetable().byId(entryId);
        if (entry == null || !entry.active || entry.historicalOnly || !entry.semesterId.equals(semesterId)) return new JSONObject().put("valid", false);
        LocalDate classDate = LocalDate.parse(date);
        if (date.compareTo(semester.startDate) < 0 || date.compareTo(semester.endDate) > 0 || date.compareTo(entry.effectiveFrom) < 0 || date.compareTo(entry.effectiveUntil) > 0) return new JSONObject().put("valid", false);
        if ((semester.workingDaysMask & (1 << (classDate.getDayOfWeek().getValue() - 1))) == 0 || !entry.day.equals(dayName(classDate.getDayOfWeek().getValue() - 1)) || db.holidays().byDate(semesterId, date) != null) return new JSONObject().put("valid", false);
        if (!classDate.atTime(LocalTime.parse(entry.start)).atZone(ZoneId.of(semester.timeZone)).toInstant().isAfter(java.time.Instant.now())) return new JSONObject().put("valid", false);
        Subject subject = db.subjects().byId(entry.subjectId);
        if (subject == null || !subject.active) return new JSONObject().put("valid", false);
        return new JSONObject().put("valid", true).put("subject", subject.name).put("start", entry.start).put("room", entry.room == null ? JSONObject.NULL : entry.room).put("date", date);
    }

    private static void validateSettingKey(String key) {
        if (key == null || key.trim().isEmpty() || key.length() > 120) throw new IllegalArgumentException("Setting key is required and must be 120 characters or fewer.");
    }

    public void runSchedulerTick() throws Exception {
        if (!"true".equalsIgnoreCase(db.settings().get("schedulerEnabled"))) return;
        try {
            Semester s = db.semesters().current(); if (s == null) return;
            String date = LocalDate.now(ZoneId.of(s.timeZone)).toString();
            if (date.compareTo(s.startDate) >= 0 && date.compareTo(s.endDate) <= 0 && (s.workingDaysMask & (1 << (LocalDate.parse(date).getDayOfWeek().getValue() - 1))) != 0) generate(date);
            String now = DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now());
            putSetting("schedulerLastRunAt", now); putSetting("schedulerLastRunDate", date); putSetting("schedulerLastError", "");
        } catch (Exception error) {
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            putSetting("schedulerLastError", message.substring(0, Math.min(500, message.length())));
            throw error;
        }
    }

    private JSONObject backupSnapshot() throws Exception {
        JSONObject data = new JSONObject(); JSONArray semesters = new JSONArray(); for (Semester s : db.semesters().all()) semesters.put(semesterJson(s));
        JSONArray subjects = new JSONArray(); for (Semester s : db.semesters().all()) for (Subject row : db.subjects().bySemester(s.id)) subjects.put(new JSONObject().put("id", row.id).put("semesterId", row.semesterId).put("name", row.name).put("code", row.code).put("attendanceTargetPercent", row.attendanceTargetPercent == null ? JSONObject.NULL : row.attendanceTargetPercent).put("active", row.active));
        JSONArray entries = new JSONArray(); for (Semester s : db.semesters().all()) for (TimetableEntry row : db.timetable().allBySemester(s.id)) entries.put(backupEntryJson(row));
        JSONArray holidays = new JSONArray(); for (Semester s : db.semesters().all()) for (Holiday row : db.holidays().bySemester(s.id)) holidays.put(new JSONObject().put("id", row.id).put("semesterId", row.semesterId).put("date", row.date).put("reason", row.reason == null ? JSONObject.NULL : row.reason));
        JSONArray occurrences = new JSONArray(); for (ClassOccurrence row : getAllOccurrences()) occurrences.put(backupOccurrenceJson(row));
        JSONArray changes = new JSONArray(); for (ClassOccurrence row : getAllOccurrences()) for (AttendanceChange c : db.changes().byOccurrence(row.id)) changes.put(changeJson(c));
        JSONArray settings = new JSONArray(); for (AppSetting row : db.settings().all()) settings.put(new JSONObject().put("key", row.key).put("value", row.value));
        data.put("semesters", semesters).put("subjects", subjects).put("timetableEntries", entries).put("holidays", holidays).put("occurrences", occurrences).put("attendanceChanges", changes).put("settings", settings);
        return new JSONObject().put("format", "attendance-tracker-backup").put("version", 1).put("exportedAt", DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now())).put("data", data);
    }

    private JSONObject restoreBackup(JSONObject backup) throws Exception {
        if (!"attendance-tracker-backup".equals(backup.optString("format")) || backup.optInt("version", -1) != 1) throw new IllegalArgumentException("This backup format or version is not supported.");
        JSONObject data = backup.optJSONObject("data"); if (data == null) throw new IllegalArgumentException("Backup data is missing.");
        JSONArray semesters = arrayRequired(data, "semesters"), subjects = arrayRequired(data, "subjects"), entries = arrayRequired(data, "timetableEntries"), holidays = arrayRequired(data, "holidays"), occurrences = arrayRequired(data, "occurrences"), changes = arrayRequired(data, "attendanceChanges"), settings = arrayRequired(data, "settings");
        // Parse and validate the complete backup before the first write.
        List<Semester> semesterRows = parseRows(semesters, this::parseSemester);
        List<Subject> subjectRows = parseRows(subjects, this::parseSubject);
        List<TimetableEntry> entryRows = parseRows(entries, this::parseEntryRow);
        List<Holiday> holidayRows = parseRows(holidays, this::parseHoliday);
        List<ClassOccurrence> occurrenceRows = parseRows(occurrences, this::parseOccurrence);
        List<AttendanceChange> changeRows = parseRows(changes, this::parseChange);
        List<AppSetting> settingRows = parseRows(settings, this::parseSetting);
        validateBackup(semesterRows, subjectRows, entryRows, holidayRows, occurrenceRows, changeRows, settingRows);
        final int total = semesterRows.size() + subjectRows.size() + entryRows.size() + holidayRows.size() + occurrenceRows.size() + changeRows.size() + settingRows.size();
        transaction(() -> {
            db.occurrences().deleteAll(); db.changes().deleteAll();
            for (Semester old : db.semesters().all()) {
                for (Holiday h : db.holidays().bySemester(old.id)) db.holidays().delete(h.id);
                db.timetable().deleteBySemester(old.id);
                db.subjects().deleteBySemester(old.id);
                db.semesters().delete(old.id);
            }
            db.settings().all().forEach(row -> db.settings().delete(row.key));
            semesterRows.forEach(db.semesters()::insert); subjectRows.forEach(db.subjects()::insert); entryRows.forEach(db.timetable()::insert);
            holidayRows.forEach(db.holidays()::insert); occurrenceRows.forEach(db.occurrences()::insert); changeRows.forEach(db.changes()::insert); settingRows.forEach(db.settings()::put);
        });
        return new JSONObject().put("imported", total);
    }

    private void validateBackup(List<Semester> ss, List<Subject> subs, List<TimetableEntry> es, List<Holiday> hs, List<ClassOccurrence> os, List<AttendanceChange> cs, List<AppSetting> settings) {
        Set<String> semesterIds = ids(ss, x -> x.id), subjectIds = ids(subs, x -> x.id), entryIds = ids(es, x -> x.id), occurrenceIds = ids(os, x -> x.id);
        ids(hs, x -> x.id); ids(cs, x -> x.id);
        Set<String> settingKeys = new HashSet<>(); for (AppSetting setting : settings) if (setting.key == null || setting.key.trim().isEmpty() || !settingKeys.add(setting.key)) throw new IllegalArgumentException("Backup contains a missing or duplicate setting key.");
        long activeSemesters = ss.stream().filter(row -> "active".equals(row.status)).count();
        if (activeSemesters > 1) throw new IllegalArgumentException("Backup contains more than one active semester.");
        Set<String> occurrencesUnique = new HashSet<>();
        java.util.Map<String, Semester> semesterById = new java.util.HashMap<>(); for (Semester semester : ss) semesterById.put(semester.id, semester);
        Set<String> subjectCodes = new HashSet<>();
        for (Subject s : subs) {
            if (!semesterIds.contains(s.semesterId)) throw new IllegalArgumentException("Backup has a subject with a missing semester.");
            if (!subjectCodes.add(s.semesterId + "|" + s.code.toLowerCase(Locale.ROOT))) throw new IllegalArgumentException("Backup contains duplicate subject codes in a semester.");
        }
        java.util.Map<String, String> subjectSemesters = new java.util.HashMap<>(); for (Subject subject : subs) subjectSemesters.put(subject.id, subject.semesterId);
        java.util.Map<String, TimetableEntry> entryById = new java.util.HashMap<>();
        for (TimetableEntry e : es) { if (!semesterIds.contains(e.semesterId) || !subjectIds.contains(e.subjectId) || !e.semesterId.equals(subjectSemesters.get(e.subjectId))) throw new IllegalArgumentException("Backup has a timetable entry with a missing or mismatched parent record."); entryById.put(e.id, e); }
        Set<String> holidayDates = new HashSet<>();
        for (Holiday h : hs) {
            Semester parent = semesterById.get(h.semesterId);
            if (parent == null) throw new IllegalArgumentException("Backup has a holiday with a missing semester.");
            if (h.date.compareTo(parent.startDate) < 0 || h.date.compareTo(parent.endDate) > 0 || !holidayDates.add(h.semesterId + "|" + h.date)) throw new IllegalArgumentException("Backup contains an invalid or duplicate holiday date.");
        }
        for (ClassOccurrence o : os) {
            TimetableEntry entry = entryById.get(o.timetableEntryId);
            if (!semesterIds.contains(o.semesterId) || !entryIds.contains(o.timetableEntryId) || !subjectIds.contains(o.subjectId) || entry == null || !o.semesterId.equals(entry.semesterId) || !o.subjectId.equals(entry.subjectId)) throw new IllegalArgumentException("Backup has an attendance record with a missing or mismatched parent record.");
            if ("PENDING".equals(o.status) == (o.finalizedAt != null)) throw new IllegalArgumentException("Backup has an attendance record with an invalid finalization time.");
            if (!occurrencesUnique.add(o.timetableEntryId + "|" + o.classDate)) throw new IllegalArgumentException("Backup contains duplicate occurrences for one timetable entry and date.");
        }
        for (AttendanceChange c : cs) if (!occurrenceIds.contains(c.occurrenceId)) throw new IllegalArgumentException("Backup has an attendance change with a missing occurrence.");
    }

    private JSONArray subjectArray() throws Exception { JSONArray a = new JSONArray(); Semester s = db.semesters().current(); if (s != null) for (Subject row : db.subjects().bySemester(s.id)) a.put(subjectJson(row)); return a; }
    private JSONArray occurrencesJson(List<ClassOccurrence> rows) throws Exception { JSONArray a = new JSONArray(); for (ClassOccurrence row : rows) a.put(occurrenceJson(row)); return a; }
    private JSONArray occurrencesArray(List<ClassOccurrence> rows) throws Exception { return occurrencesJson(rows); }
    private JSONObject occurrenceJson(ClassOccurrence r) throws Exception { return new JSONObject().put("id", r.id).put("subjectId", r.subjectId).put("timetableEntryId", r.timetableEntryId).put("date", r.classDate).put("subject", r.subjectNameSnapshot).put("code", r.subjectCodeSnapshot).put("start", r.start).put("end", r.end).put("room", r.roomSnapshot == null ? JSONObject.NULL : r.roomSnapshot).put("status", titleStatus(r.status)).put("note", r.note == null ? JSONObject.NULL : r.note).put("finalizedAt", r.finalizedAt == null ? JSONObject.NULL : DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.ofEpochMilli(r.finalizedAt))); }
    private JSONObject backupOccurrenceJson(ClassOccurrence r) throws Exception { return occurrenceJson(r).put("semesterId", r.semesterId).put("generatedAt", r.generatedAt).put("finalizedAt", r.finalizedAt == null ? JSONObject.NULL : r.finalizedAt); }
    private JSONObject semesterJson(Semester s) throws Exception { if (s == null) return null; JSONArray days = new JSONArray(); for (int i=0;i<DAYS.length;i++) if ((s.workingDaysMask & (1 << i)) != 0) days.put(DAYS[i]); return new JSONObject().put("id", s.id).put("name", s.name).put("startDate", s.startDate).put("endDate", s.endDate).put("workingDays", days).put("attendanceTargetPercent", s.attendanceTargetPercent == null ? JSONObject.NULL : s.attendanceTargetPercent).put("status", s.status).put("timeZone", s.timeZone); }
    private JSONObject subjectJson(Subject s) throws Exception { return new JSONObject().put("id", s.id).put("name", s.name).put("code", s.code).put("attendanceTargetPercent", s.attendanceTargetPercent == null ? JSONObject.NULL : s.attendanceTargetPercent).put("active", s.active); }
    private JSONObject entryJson(TimetableEntry e) throws Exception { Subject s = db.subjects().byId(e.subjectId); return new JSONObject().put("id", e.id).put("subjectId", e.subjectId).put("subject", s == null ? "" : s.name).put("code", s == null ? "" : s.code).put("day", e.day).put("start", e.start).put("end", e.end).put("room", e.room == null ? JSONObject.NULL : e.room).put("active", e.active).put("effectiveFrom", e.effectiveFrom).put("effectiveUntil", e.effectiveUntil); }
    private JSONObject backupEntryJson(TimetableEntry e) throws Exception { return entryJson(e).put("semesterId", e.semesterId).put("historicalOnly", e.historicalOnly); }
    private JSONObject holidayJson(Holiday h) throws Exception { return new JSONObject().put("id", h.id).put("date", h.date).put("reason", h.reason == null ? JSONObject.NULL : h.reason); }
    private JSONObject changeJson(AttendanceChange c) throws Exception { return new JSONObject().put("id", c.id).put("occurrenceId", c.occurrenceId).put("actorType", c.actorType).put("oldStatus", titleStatus(c.oldStatus)).put("newStatus", titleStatus(c.newStatus)).put("reason", c.reason == null ? JSONObject.NULL : c.reason).put("changedAt", c.changedAt); }
    private JSONObject countSummary(List<ClassOccurrence> rows, boolean includeCancelledFinalized) throws Exception { int present=0, absent=0, pending=0, cancelled=0; for (ClassOccurrence r:rows) switch(r.status){case "PRESENT":present++;break;case "ABSENT":absent++;break;case "PENDING":pending++;break;case "CANCELLED":cancelled++;break;default:break;} int finalized=present+absent+(includeCancelledFinalized?cancelled:0); return new JSONObject().put("Present",present).put("Absent",absent).put("Pending",pending).put("Cancelled",cancelled).put("finalized",finalized).put("total",rows.size()).put("attendancePercent",percent(present,absent)==null?JSONObject.NULL:percent(present,absent)); }
    private List<ClassOccurrence> getAllOccurrences() { List<ClassOccurrence> rows = new ArrayList<>(); for (Semester s : db.semesters().all()) for (Subject subject : db.subjects().bySemester(s.id)) rows.addAll(db.occurrences().bySubject(subject.id)); return rows; }
    private List<ClassOccurrence> subsetFor(List<ClassOccurrence> rows, String subjectId) { List<ClassOccurrence> out=new ArrayList<>(); for(ClassOccurrence row:rows)if(row.subjectId.equals(subjectId))out.add(row);return out; }
    private Semester requireCurrentSemester() { Semester s=db.semesters().current(); if(s==null)throw new IllegalArgumentException("Set up a semester before editing the timetable.");return s; }
    private void putSetting(String key,String value){ AppSetting s=new AppSetting();s.key=key;s.value=value;db.settings().put(s); }
    private static Double percent(int present,int absent){int total=present+absent;return total==0?null:Math.round(present*1000.0/total)/10.0;}
    private static String normalizeStatus(String value){String status=value.trim().toUpperCase(Locale.ROOT);for(String allowed:STATUSES)if(allowed.equals(status))return status;throw new IllegalArgumentException("Choose Pending, Present, Absent, or Cancelled.");}
    private static String titleStatus(String status){return status.substring(0,1)+status.substring(1).toLowerCase(Locale.ROOT);}
    private static String uuid(){return UUID.randomUUID().toString();}
    private static String required(JSONObject p,String key){String value=p.optString(key,"").trim();if(value.isEmpty()||"null".equals(value))throw new IllegalArgumentException("Missing required field: "+key);return value;}
    private static String text(JSONObject p,String key){return required(p,key);}
    private static int dayIndex(String day){for(int i=0;i<DAYS.length;i++)if(DAYS[i].equals(day))return i;throw new IllegalArgumentException("Choose a valid weekday.");}
    private static String dayName(int index){if(index<0||index>=DAYS.length)throw new IllegalArgumentException("Invalid weekday.");return DAYS[index];}
    private static String validTime(String value){if(value==null||!value.matches("(?:[01]\\d|2[0-3]):[0-5]\\d"))throw new IllegalArgumentException("Enter a valid 24-hour time.");return value;}
    private static int timeMinutes(String value){try{return LocalTime.parse(value).getHour()*60+LocalTime.parse(value).getMinute();}catch(Exception e){return -1;}}
    private static String validDate(String value,String label){try{if(value==null||!value.matches("\\d{4}-\\d{2}-\\d{2}"))throw new Exception();LocalDate.parse(value);return value;}catch(Exception e){throw new IllegalArgumentException("Enter a valid "+label+".");}}
    private static void validateTarget(Double target){if(target!=null&&(!Double.isFinite(target)||target<0||target>100))throw new IllegalArgumentException("Attendance target must be between 0 and 100.");}
    private static Double nullableDouble(JSONObject p,String key){if(!p.has(key)||p.isNull(key))return null;Object value=p.opt(key);if(value instanceof String&&((String)value).trim().isEmpty())return null;double d=p.optDouble(key,Double.NaN);if(!Double.isFinite(d))throw new IllegalArgumentException(key+" must be a number.");return d;}
    private static String validZone(String zone){try{return ZoneId.of(zone).getId();}catch(Exception e){throw new IllegalArgumentException("Choose a valid time zone.");}}
    private static String later(String a,String b){return a.isEmpty()||a.compareTo(b)<0?b:a;}
    private static String earlier(String a,String b){return a.isEmpty()||a.compareTo(b)>0?b:a;}
    private static JSONArray arrayRequired(JSONObject o,String key){JSONArray a=o.optJSONArray(key);if(a==null)throw new IllegalArgumentException("Backup is missing "+key+".");return a;}

    private interface TransactionWork { void run() throws Exception; }
    private static final class TransactionFailure extends RuntimeException { final Exception original; TransactionFailure(Exception original){super(original);this.original=original;} }
    private void transaction(TransactionWork work) throws Exception {
        try { db.runInTransaction(() -> { try { work.run(); } catch (Exception error) { throw new TransactionFailure(error); } }); }
        catch (TransactionFailure error) { throw error.original; }
    }

    private interface Parser<T>{T parse(JSONObject row)throws Exception;}
    private interface Id<T>{String get(T item);}
    private static <T> List<T> parseRows(JSONArray rows,Parser<T> parser)throws Exception{List<T> result=new ArrayList<>();for(int i=0;i<rows.length();i++)result.add(parser.parse(rows.getJSONObject(i)));return result;}
    private static <T> Set<String> ids(List<T> rows,Id<T> getter){Set<String> result=new HashSet<>();for(T row:rows){String id=getter.get(row);if(id==null||id.trim().isEmpty()||!result.add(id))throw new IllegalArgumentException("Backup contains a missing or duplicate ID.");}return result;}
    private Semester parseSemester(JSONObject o)throws Exception{Semester s=new Semester();s.id=required(o,"id");s.name=text(o,"name");if(s.name.length()>120)throw new IllegalArgumentException("Backup has a semester name that is too long.");s.startDate=validDate(text(o,"startDate"),"semester start date");s.endDate=validDate(text(o,"endDate"),"semester end date");if(s.endDate.compareTo(s.startDate)<0)throw new IllegalArgumentException("Backup has invalid semester dates.");JSONArray days=arrayRequired(o,"workingDays");for(int i=0;i<days.length();i++){int bit=1<<dayIndex(days.getString(i));if((s.workingDaysMask&bit)!=0)throw new IllegalArgumentException("Backup has duplicate semester working days.");s.workingDaysMask|=bit;}s.attendanceTargetPercent=nullableDouble(o,"attendanceTargetPercent");validateTarget(s.attendanceTargetPercent);s.status=o.optString("status","draft");if(!"draft".equals(s.status)&&!"active".equals(s.status)&&!"archived".equals(s.status))throw new IllegalArgumentException("Backup has an invalid semester status.");s.timeZone=validZone(o.optString("timeZone","UTC"));return s;}
    private Subject parseSubject(JSONObject o)throws Exception{Subject s=new Subject();s.id=required(o,"id");s.semesterId=required(o,"semesterId");s.name=text(o,"name");s.code=text(o,"code");s.attendanceTargetPercent=nullableDouble(o,"attendanceTargetPercent");validateTarget(s.attendanceTargetPercent);s.active=o.optBoolean("active",true);return s;}
    private TimetableEntry parseEntryRow(JSONObject o)throws Exception{TimetableEntry e=new TimetableEntry();e.id=required(o,"id");e.semesterId=required(o,"semesterId");e.subjectId=required(o,"subjectId");e.day=dayName(dayIndex(text(o,"day")));e.start=validTime(text(o,"start"));e.end=validTime(text(o,"end"));if(e.end.compareTo(e.start)<=0)throw new IllegalArgumentException("Backup has an invalid timetable time range.");e.room=nullableText(o,"room");e.effectiveFrom=validDate(text(o,"effectiveFrom"),"timetable start date");e.effectiveUntil=validDate(text(o,"effectiveUntil"),"timetable end date");if(e.effectiveUntil.compareTo(e.effectiveFrom)<0)throw new IllegalArgumentException("Backup has invalid timetable dates.");e.active=o.optBoolean("active",true);e.historicalOnly=o.optBoolean("historicalOnly",false);return e;}
    private Holiday parseHoliday(JSONObject o)throws Exception{Holiday h=new Holiday();h.id=required(o,"id");h.semesterId=required(o,"semesterId");h.date=validDate(text(o,"date"),"holiday date");h.reason=nullableText(o,"reason");return h;}
    private ClassOccurrence parseOccurrence(JSONObject o)throws Exception{ClassOccurrence r=new ClassOccurrence();r.id=required(o,"id");r.semesterId=required(o,"semesterId");r.timetableEntryId=required(o,"timetableEntryId");r.subjectId=required(o,"subjectId");r.classDate=validDate(text(o,"date"),"class date");r.start=validTime(text(o,"start"));r.end=validTime(text(o,"end"));if(r.end.compareTo(r.start)<=0)throw new IllegalArgumentException("Backup has an invalid class time range.");r.subjectNameSnapshot=text(o,"subject");r.subjectCodeSnapshot=text(o,"code");r.roomSnapshot=nullableText(o,"room");r.status=normalizeStatus(text(o,"status"));r.note=nullableText(o,"note");r.generatedAt=o.optLong("generatedAt",System.currentTimeMillis());r.finalizedAt=o.has("finalizedAt")&&!o.isNull("finalizedAt")?o.optLong("finalizedAt"):null;return r;}
    private AttendanceChange parseChange(JSONObject o)throws Exception{AttendanceChange c=new AttendanceChange();c.id=required(o,"id");c.occurrenceId=required(o,"occurrenceId");c.actorType=o.optString("actorType","user");if(!"user".equals(c.actorType)&&!"system".equals(c.actorType))throw new IllegalArgumentException("Backup has an invalid attendance change actor.");c.oldStatus=normalizeStatus(text(o,"oldStatus"));c.newStatus=normalizeStatus(text(o,"newStatus"));if(c.oldStatus.equals(c.newStatus))throw new IllegalArgumentException("Backup has an invalid attendance change.");c.reason=nullableText(o,"reason");c.changedAt=o.optLong("changedAt",System.currentTimeMillis());return c;}
    private AppSetting parseSetting(JSONObject o)throws Exception{AppSetting s=new AppSetting();s.key=text(o,"key");s.value=o.optString("value","");return s;}
    private static String nullableText(JSONObject object,String key){return !object.has(key)||object.isNull(key)?null:object.optString(key,null);}
}
