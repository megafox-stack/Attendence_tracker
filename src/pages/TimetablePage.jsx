import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, Info, List, Pencil, Plus, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { EmptyState, Field, Notice, Overlay, PageHeading, SelectField } from '../App.jsx';
import { ApiError, ApiUnavailableError, hasSessionToken } from '../services/apiClient.js';
import { saveCurrentSemester, getCurrentSemester } from '../services/semesterService.js';
import { createSubject, deleteSubject, getSubjects, updateSubject } from '../services/subjectsService.js';
import { createHoliday, createTimetableEntry, deleteHoliday, deleteTimetableEntry, getSemesterTimetable, setTimetableEntryActive, updateTimetableEntry } from '../services/timetableService.js';
import { getSchedulerStatus, updateScheduler } from '../services/schedulerService.js';
import { DAYS } from '../utils/dateUtils.js';

const blankSemester = { name: '', start: '', end: '', target: '' };
const blankSubject = { name: '', code: '', target: '' };
const blankEntry = { subject: '', code: '', day: 'Monday', start: '', end: '', room: '', active: true };
// These are view preferences only. Timetable records continue to load from the account API.
let rememberedDay = 'Monday';
let rememberedView = 'Weekly view';
function timeMinutes(value) { if (!value) return -1; const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; }

export default function TimetablePage() {
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [semester, setSemester] = useState(blankSemester);
  const [semesterOpen, setSemesterOpen] = useState(false);
  const [workingDays, setWorkingDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState(rememberedDay);
  const [view, setView] = useState(rememberedView);
  const [weekOffset, setWeekOffset] = useState(0);
  const [subjectForm, setSubjectForm] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [entryForm, setEntryForm] = useState(null);
  const [pendingClassDay, setPendingClassDay] = useState(null);
  const [entries, setEntries] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [subjectDeleteTarget, setSubjectDeleteTarget] = useState(null);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holiday, setHoliday] = useState({ date: '', reason: '' });
  const [holidays, setHolidays] = useState([]);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [accountState, setAccountState] = useState(hasSessionToken() ? 'loading' : 'signed-out');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadAccountData() {
      if (!hasSessionToken()) {
        setSemester(blankSemester);
        setWorkingDays([]);
        setSubjects([]);
        setEntries([]);
        setHolidays([]);
        setSchedulerStatus(null);
        setAccountState('signed-out');
        return;
      }
      setAccountState('loading');
      try {
        const [currentSemester, savedSubjects, timetable, schedulerResult] = await Promise.all([getCurrentSemester(), getSubjects(), getSemesterTimetable(), getSchedulerStatus()]);
        if (!active) return;
        setSemester(currentSemester ? {
          id: currentSemester.id,
          name: currentSemester.name,
          start: currentSemester.startDate,
          end: currentSemester.endDate,
          target: currentSemester.attendanceTargetPercent == null ? '' : String(currentSemester.attendanceTargetPercent),
        } : blankSemester);
        setWorkingDays(currentSemester?.workingDays || []);
        setSubjects(savedSubjects.map((item) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          target: item.attendanceTargetPercent == null ? '' : String(item.attendanceTargetPercent),
        })));
        setEntries(timetable.entries || []);
        setHolidays(timetable.holidays || []);
        setSchedulerStatus(schedulerResult.scheduler);
        setAccountState('ready');
        setFormError('');
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setSemester(blankSemester);
          setWorkingDays([]);
          setSubjects([]);
          setEntries([]);
          setHolidays([]);
          setAccountState('signed-out');
        } else setAccountState('error');
        setFormError(error instanceof ApiUnavailableError ? 'The backend is not reachable. Check the API connection and retry.' : error.message);
      }
    }
    loadAccountData();
    globalThis.addEventListener('attenda:session-change', loadAccountData);
    return () => {
      active = false;
      globalThis.removeEventListener('attenda:session-change', loadAccountData);
    };
  }, []);

  const visibleDays = useMemo(() => DAYS.filter((day) => workingDays.includes(day)), [workingDays]);
  const renderedEntries = view === 'List view' ? entries : entries.filter((entry) => entry.day === selectedDay);

  useEffect(() => {
    if (visibleDays.length && !visibleDays.includes(selectedDay)) {
      rememberedDay = visibleDays[0];
      setSelectedDay(visibleDays[0]);
    }
  }, [visibleDays, selectedDay]);

  function updateWorkingDay(day) { setWorkingDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]); }
  async function toggleScheduler() {
    if (!schedulerStatus || schedulerBusy) return;
    setSchedulerBusy(true);
    setFormError('');
    try {
      const result = await updateScheduler({ enabled: !schedulerStatus.enabled });
      setSchedulerStatus(result.scheduler);
      setMessage(result.scheduler.enabled ? 'Automatic scheduler enabled on the backend. It creates Pending records from your timetable once per local day.' : 'Automatic scheduler disabled on the backend. Existing attendance records are unchanged.');
    } catch (error) {
      setFormError(error instanceof ApiUnavailableError ? 'The backend is not reachable. Scheduler settings were not changed.' : error.message);
    } finally { setSchedulerBusy(false); }
  }
  async function submitSemester(event) {
    event.preventDefault(); setFormError('');
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!semester.start || !semester.end || semester.end < semester.start) { setFormError('Enter valid semester dates. The end date must be on or after the start date.'); return; }
    if (!workingDays.length) { setFormError('Choose at least one working day.'); return; }
    const data = new FormData(form);
    setSaving(true);
    try {
      const saved = await saveCurrentSemester({
        name: String(data.get('name')).trim(),
        startDate: semester.start,
        endDate: semester.end,
        attendanceTargetPercent: semester.target === '' ? null : Number(semester.target),
        workingDays,
      });
      setSemester({ id: saved.id, name: saved.name, start: saved.startDate, end: saved.endDate, target: saved.attendanceTargetPercent == null ? '' : String(saved.attendanceTargetPercent) });
      setWorkingDays(saved.workingDays);
      setAccountState('ready');
      setSemesterOpen(false);
      if (pendingClassDay !== null) {
        if (subjects.length) {
          setEntryForm({ ...blankEntry, day: pendingClassDay, subjectId: subjects[0].id });
          setPendingClassDay(null);
        } else setSubjectForm({ ...blankSubject });
      }
      setMessage('Semester details saved to your account.');
    } catch (error) {
      setFormError(error instanceof ApiUnavailableError ? 'The backend is not reachable. Your semester was not saved.' : error.message);
    } finally { setSaving(false); }
  }
  async function submitSubject(event) {
    event.preventDefault(); setFormError('');
    if (!event.currentTarget.reportValidity()) return;
    if (!semester.id) { setFormError('Set up a semester before adding subjects.'); return; }
    const data = new FormData(event.currentTarget); const input = { name: String(data.get('name')).trim(), code: String(data.get('code')).trim(), attendanceTargetPercent: String(data.get('target')).trim() === '' ? null : Number(data.get('target')) };
    const nextId = subjectForm?.id;
    if (subjects.some((item) => item.id !== nextId && item.code.toLowerCase() === input.code.toLowerCase())) { setFormError('A subject with that code already exists.'); return; }
    setSaving(true);
    try {
      const saved = nextId ? await updateSubject(nextId, input) : await createSubject(input);
      const next = { id: saved.id, name: saved.name, code: saved.code, target: saved.attendanceTargetPercent == null ? '' : String(saved.attendanceTargetPercent) };
      setSubjects((current) => nextId ? current.map((item) => item.id === nextId ? next : item) : [...current, next]);
      setSubjectForm(null); setAccountState('ready');
      if (!nextId && pendingClassDay !== null) {
        setEntryForm({ ...blankEntry, day: pendingClassDay, subjectId: next.id });
        setPendingClassDay(null);
      }
      setMessage('Subject saved to your account.');
    } catch (error) {
      setFormError(error instanceof ApiUnavailableError ? 'The backend is not reachable. Your subject was not saved.' : error.message);
    } finally { setSaving(false); }
  }
  async function confirmSubjectDelete() {
    if (!subjectDeleteTarget) return;
    setSaving(true);
    try {
      await deleteSubject(subjectDeleteTarget.id);
      setSubjects((current) => current.filter((item) => item.id !== subjectDeleteTarget.id));
      setMessage('Subject deleted from your account.');
      setSubjectDeleteTarget(null);
    } catch (error) {
      setMessage(error instanceof ApiUnavailableError ? 'The backend is not reachable. The subject was not deleted.' : error.message);
      setSubjectDeleteTarget(null);
    } finally { setSaving(false); }
  }
  async function submitEntry(event) {
    event.preventDefault(); setFormError('');
    if (!event.currentTarget.reportValidity()) return;
    const data = new FormData(event.currentTarget);
    const input = { subjectId: String(data.get('subjectId')), day: String(data.get('day')), start: String(data.get('start')), end: String(data.get('end')), room: String(data.get('room')).trim(), active: editingEntry ? editingEntry.active : true };
    if (timeMinutes(input.end) <= timeMinutes(input.start)) { setFormError('Class end time must be later than its start time.'); return; }
    if (!workingDays.includes(input.day)) { setFormError('Choose a day enabled in your semester working days.'); return; }
    setSaving(true);
    try {
      const saved = editingEntry ? await updateTimetableEntry(editingEntry.id, input) : await createTimetableEntry(input);
      setEntries((current) => editingEntry ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start.localeCompare(b.start)));
      setEntryForm(null); setEditingEntry(null); setMessage('Timetable entry saved to your account.');
    } catch (error) { setFormError(error instanceof ApiUnavailableError ? 'The backend is not reachable. Your timetable entry was not saved.' : error.message); }
    finally { setSaving(false); }
  }
  async function toggleEntry(entry) {
    setSaving(true);
    try { const active = !entry.active; await setTimetableEntryActive(entry.id, active); setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, active } : item)); setMessage(`Timetable entry ${active ? 'enabled' : 'disabled'} on your account.`); }
    catch (error) { setMessage(error instanceof ApiUnavailableError ? 'The backend is not reachable. Entry status was not changed.' : error.message); }
    finally { setSaving(false); }
  }
  async function confirmEntryDelete() {
    if (!deleteTarget) return; setSaving(true);
    try {
      const result = await deleteTimetableEntry(deleteTarget.id);
      if (result?.preservedRecords) {
        setEntries((current) => current.map((item) => item.id === deleteTarget.id ? { ...item, active: false } : item));
        setMessage('This class has attendance records, so it was disabled in the recurring timetable. Existing records were preserved.');
      } else {
        setEntries((current) => current.filter((item) => item.id !== deleteTarget.id));
        setMessage('Timetable entry deleted from your account.');
      }
      setDeleteTarget(null);
    }
    catch (error) { setMessage(error instanceof ApiUnavailableError ? 'The backend is not reachable. The entry was not deleted.' : error.message); setDeleteTarget(null); }
    finally { setSaving(false); }
  }
  async function confirmHoliday(event) {
    event.preventDefault(); setFormError(''); if (!event.currentTarget.reportValidity()) return;
    if (!semester.start || !semester.end || holiday.date < semester.start || holiday.date > semester.end) { setFormError('Choose a holiday date within the configured semester.'); return; }
    if (holidays.some((item) => item.date === holiday.date)) { setFormError('A holiday is already set for that date.'); return; }
    setSaving(true);
    try { const result = await createHoliday(holiday); setHolidays((current) => [...current, result.holiday].sort((a, b) => a.date.localeCompare(b.date))); setHoliday({ date: '', reason: '' }); setHolidayOpen(false); setMessage('Holiday saved to your account. Recurring classes and historical records are preserved.'); }
    catch (error) { setFormError(error instanceof ApiUnavailableError ? 'The backend is not reachable. The holiday was not saved.' : error.message); }
    finally { setSaving(false); }
  }
  async function removeHoliday(item) {
    if (!globalThis.confirm(`Remove holiday on ${item.date}?`)) return;
    setSaving(true);
    try { await deleteHoliday(item.id); setHolidays((current) => current.filter((holidayItem) => holidayItem.id !== item.id)); setMessage('Holiday removed from your account.'); }
    catch (error) { setMessage(error instanceof ApiUnavailableError ? 'The backend is not reachable. The holiday was not removed.' : error.message); }
    finally { setSaving(false); }
  }
  function startSubjectForm() {
    setFormError('');
    setPendingClassDay(null);
    if (accountState !== 'ready') { setMessage('Sign in and connect to the backend before adding a subject.'); return; }
    if (!semester.id) { setFormError('A semester is required before adding subjects. Set up your semester first.'); setSemesterOpen(true); return; }
    setSubjectForm({ ...blankSubject });
  }
  function startClassForm(day = selectedDay) {
    setFormError('');
    if (accountState !== 'ready') { setMessage('Sign in and connect to the backend before adding a class.'); return; }
    if (!semester.id) {
      setPendingClassDay(day);
      setFormError('Set up your semester before adding a class.');
      setSemesterOpen(true);
      return;
    }
    if (!subjects.length) {
      setPendingClassDay(day);
      setSubjectForm({ ...blankSubject });
      return;
    }
    setEditingEntry(null);
    setEntryForm({ ...blankEntry, day, subjectId: subjects[0].id });
  }

  return <><PageHeading eyebrow="YOUR WEEK AT A GLANCE" title="Timetable & Scheduler" description="Plan your weekly classes and set up attendance generation." action={<button type="button" className="button button-primary" disabled={accountState !== 'ready'} onClick={() => startClassForm()}><Plus size={15} />Add class</button>} />
    {message && <div className="inline-feedback" role="status"><Check size={15} />{message}<button type="button" aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    {accountState === 'signed-out' && <div className="inline-feedback" role="status">Sign in to load or save semester and subject details. These account records are not stored in this browser.</div>}
    {accountState === 'loading' && <div className="inline-feedback" role="status">Loading semester and subjects from your account…</div>}
    {accountState === 'error' && <div className="inline-feedback" role="alert">{formError || 'Could not load account data from the backend.'}<button type="button" onClick={() => globalThis.dispatchEvent(new Event('attenda:session-change'))}>Retry</button></div>}
    <div className="timetable-layout"><main className="timetable-main">
      <section className="card scheduler-panel"><div className="scheduler-panel-heading"><div className="large-card-icon scheduler-card-icon"><CalendarDays size={19} /></div><div className="scheduler-title-copy"><div className="card-title-line"><h2>Automatic scheduler</h2><span className={`state-pill ${schedulerStatus?.status === 'error' ? 'scheduler-error' : schedulerStatus?.enabled ? 'scheduler-enabled' : 'state-neutral'}`}><span />{accountState !== 'ready' ? 'Not connected' : schedulerStatus?.status === 'error' ? 'Error' : schedulerStatus?.enabled ? 'Active' : schedulerStatus?.configured ? 'Disabled' : 'Setup required'}</span></div><p>Creates Pending records from your saved timetable once per local day.</p></div><button type="button" role="switch" aria-checked={Boolean(schedulerStatus?.enabled)} aria-label="Enable or disable automatic scheduler" className={`toggle-control${schedulerStatus?.enabled ? ' toggle-on' : ''}`} onClick={toggleScheduler} disabled={accountState !== 'ready' || !schedulerStatus || schedulerBusy}><span /></button></div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {!schedulerStatus?.configured && accountState === 'ready' && <Notice tone="warning">Set up a semester and add at least one active weekly class before enabling the scheduler.</Notice>}
        <p className="scheduler-explain">The scheduler generates Pending records from your saved timetable. It does not independently verify whether you attended class.</p><div className="scheduler-meta-grid"><div className="scheduler-meta"><span className="meta-icon"><Clock3 size={15} /></span><div><small>Last scheduler check</small><strong>{schedulerStatus?.lastRunAt ? new Date(schedulerStatus.lastRunAt).toLocaleString() : 'Unavailable'}</strong><span>{schedulerStatus?.lastError || (schedulerStatus?.lastRunDate ? `Local date ${schedulerStatus.lastRunDate}` : 'No scheduler run recorded yet')}</span></div></div><div className="scheduler-meta"><span className="meta-icon meta-blue"><CalendarPlus size={15} /></span><div><small>Next check</small><strong>{schedulerStatus?.enabled ? 'Within one minute' : 'Not scheduled'}</strong><span>{schedulerStatus?.enabled ? 'Runs on the backend' : 'Enable the scheduler to start'}</span></div></div></div></section>
      <section className="card semester-panel"><div className="section-title"><div><h2>Semester setup</h2><p>Set the dates and working days for your timetable.</p></div><button type="button" className="icon-button" aria-label="Edit semester details" onClick={() => { setSemesterOpen(true); setFormError(''); }}><Pencil size={15} /></button></div>{semester.name ? <div className="semester-detail"><div className="semester-detail-icon"><CalendarDays size={17} /></div><div><strong>{semester.name}</strong><span>{semester.start && semester.end ? `${semester.start} – ${semester.end}` : 'Semester dates not set'}</span><span className="semester-working">{workingDays.length ? workingDays.join(' · ') : 'Working days need configuration'}</span></div><span className="session-tag">{accountState === 'ready' ? 'Saved to account' : 'Not loaded'}</span></div> : <EmptyState icon={CalendarDays} title="No semester configured" description="Add your semester name and dates to start building a recurring timetable." action={<button type="button" className="button button-secondary button-small" onClick={() => { setSemesterOpen(true); setFormError(''); }}><Plus size={14} />Set up semester</button>} />}</section>
      <section className="card timetable-panel"><div className="section-title timetable-panel-title"><div><h2>Weekly timetable</h2><p>Your recurring class schedule, organized by day.</p></div><button type="button" className="button button-secondary button-small" disabled={accountState !== 'ready'} onClick={() => startClassForm()}><Plus size={14} />Add class</button></div>
        <div className="timetable-toolbar"><div className="view-switch" role="group" aria-label="Timetable view"><button type="button" className={view === 'Weekly view' ? 'active' : ''} onClick={() => { rememberedView = 'Weekly view'; setView('Weekly view'); }}><CalendarDays size={14} />Weekly</button><button type="button" className={view === 'List view' ? 'active' : ''} onClick={() => { rememberedView = 'List view'; setView('List view'); }}><List size={14} />List</button></div><div className="week-control"><button type="button" aria-label="Previous week" onClick={() => setWeekOffset((value) => value - 1)}><ChevronLeft size={15} /></button><span>{weekOffset === 0 ? 'Current week' : `${Math.abs(weekOffset)} week${Math.abs(weekOffset) === 1 ? '' : 's'} ${weekOffset > 0 ? 'ahead' : 'back'}`}</span><button type="button" aria-label="Next week" onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight size={15} /></button></div></div>
        {view === 'Weekly view' && <div className="day-selector" role="tablist" aria-label="Select a day">{DAYS.map((day, index) => { const enabled = workingDays.includes(day); return <button type="button" role="tab" aria-selected={selectedDay === day} disabled={!enabled} key={day} className={`day-button${selectedDay === day ? ' selected' : ''}${!enabled ? ' day-disabled' : ''}`} onClick={() => { rememberedDay = day; setSelectedDay(day); }}><span>{day.slice(0, 3)}</span><small>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</small></button>; })}</div>}
        {(view === 'List view' ? visibleDays : [selectedDay]).map((day) => { const dayEntries = renderedEntries.filter((entry) => entry.day === day); return <div className="day-list-block" key={day}><div className="day-list-heading"><span>{day}</span><span>{dayEntries.length ? `${dayEntries.length} ${dayEntries.length === 1 ? 'class' : 'classes'}` : 'No classes'}</span><button type="button" aria-label={`Add class on ${day}`} disabled={accountState !== 'ready'} onClick={() => startClassForm(day)}><Plus size={14} /></button></div>{dayEntries.length ? dayEntries.map((entry) => <article className="timetable-entry" key={entry.id}><div className="entry-time"><strong>{entry.start}</strong><span>to {entry.end}</span></div><div className="entry-subject"><strong>{entry.subject}</strong><span>{entry.code}{entry.room ? ` · ${entry.room}` : ''}</span></div><span className={`entry-state${entry.active ? '' : ' entry-inactive'}`}><span />{entry.active ? 'Active' : 'Inactive'}</span><button type="button" className="icon-button entry-menu" disabled={saving} aria-label={`Edit ${entry.subject}`} onClick={() => { setEditingEntry(entry); setEntryForm({ ...entry, subjectId: entry.subjectId }); setFormError(''); }}><Pencil size={14} /></button><button type="button" className="icon-button entry-menu" disabled={saving} aria-label={`${entry.active ? 'Disable' : 'Enable'} ${entry.subject}`} onClick={() => toggleEntry(entry)}><RotateCcw size={14} /></button><button type="button" className="icon-button entry-menu" disabled={saving} aria-label={`Delete ${entry.subject}`} onClick={() => setDeleteTarget(entry)}><Trash2 size={14} /></button></article>) : <div className="day-empty"><span className="day-empty-icon"><Clock3 size={16} /></span><p>No timetable entries for {day}. Add a class to build your recurring week.</p></div>}</div>; })}
        {holidays.length > 0 && <div className="holiday-list"><p className="card-kicker">HOLIDAYS IN THIS SEMESTER</p>{holidays.map((item) => <div className="holiday-row" key={item.id}><CalendarDays size={15} /><span><strong>{item.date}</strong>{item.reason ? ` · ${item.reason}` : ''}</span><button type="button" disabled={saving} aria-label={`Remove holiday on ${item.date}`} onClick={() => removeHoliday(item)}><Trash2 size={14} /></button></div>)}</div>}
        <button type="button" className="holiday-trigger" disabled={accountState !== 'ready' || !semester.id} onClick={() => { setHolidayOpen(true); setFormError(''); }}><CalendarPlus size={15} />Add a holiday<span>Calendar event</span><ChevronRight size={15} /></button>
      </section>
      <div className="scheduler-info"><div className="scheduler-info-icon"><Info size={15} /></div><p><strong>How the scheduler works</strong><span>The scheduler creates Pending records from your saved timetable. It does not decide whether you attended a class; confirm each record in your daily review.</span></p></div>
    </main><aside className="timetable-aside"><section className="card sidebar-summary"><div className="summary-card-top"><span className="summary-card-icon"><SlidersHorizontal size={17} /></span><span className="state-pill state-neutral"><span />Setup needed</span></div><h2>Your timetable setup</h2><p>Set up your semester and classes to create a recurring weekly schedule.</p><div className="setup-steps"><div className={`setup-step${semester.name ? ' step-done' : ''}`}><span>{semester.name ? <Check size={12} /> : '1'}</span><div><strong>Semester details</strong><small>{semester.name ? 'Added for this session' : 'Add dates and working days'}</small></div></div><div className={`setup-step${subjects.length ? ' step-done' : ''}`}><span>{subjects.length ? <Check size={12} /> : '2'}</span><div><strong>Add your subjects</strong><small>{subjects.length ? `${subjects.length} available this session` : 'Add names and subject codes'}</small></div></div><div className={`setup-step${entries.length ? ' step-done' : ''}`}><span>{entries.length ? <Check size={12} /> : '3'}</span><div><strong>Plan your weekly classes</strong><small>{entries.length ? `${entries.length} entries this session` : 'Add class times and rooms'}</small></div></div><div className="setup-step"><span>4</span><div><strong>Connect a backend</strong><small>Save your schedule to your account</small></div></div></div></section>
      <section className="card subjects-panel"><div className="aside-section-heading"><div><span className="card-kicker">YOUR SUBJECTS</span><h2>Subjects <span>{subjects.length || ''}</span></h2></div><button type="button" className="icon-button plus-icon" aria-label="Add a subject" onClick={startSubjectForm}><Plus size={16} /></button></div>{subjects.length ? <div className="saved-subject-list">{subjects.map((subject) => <article className="saved-subject-row" key={subject.id}><span className="saved-subject-icon">{subject.name.charAt(0).toUpperCase()}</span><div><strong>{subject.name}</strong><span>{subject.code}{subject.target ? ` · Target ${subject.target}%` : ''}</span></div><button type="button" aria-label={`Edit ${subject.name}`} onClick={() => { setSubjectForm(subject); setFormError(''); }}><Pencil size={13} /></button><button type="button" aria-label={`Delete ${subject.name}`} onClick={() => setSubjectDeleteTarget(subject)}><Trash2 size={13} /></button></article>)}</div> : <div className="subjects-empty"><span className="mini-empty-icon"><Settings2 size={17} /></span><p>{accountState === 'ready' ? (semester.id ? 'No subjects saved for this semester.' : 'Set up a semester before adding subjects.') : 'Sign in and configure a semester before adding subjects.'}</p></div>}<button type="button" className="link-button add-subject" onClick={startSubjectForm}><Plus size={14} />Add a subject</button></section>
      <section className="save-status"><div className="save-status-icon"><ShieldCheck size={17} /></div><div><strong>Account data saves to the backend</strong><span>Semester, subjects, recurring class entries and holidays are stored on your account. Scheduler generation remains unavailable until its service is connected.</span></div></section>
    </aside></div>
    {semesterOpen && <Overlay title="Semester details" onClose={() => { setSemesterOpen(false); setPendingClassDay(null); }} footer={<><button type="button" className="button button-secondary" onClick={() => { setSemesterOpen(false); setPendingClassDay(null); }}>Cancel</button><button type="submit" form="semester-form" className="button button-primary" disabled={saving || accountState !== 'ready'}><Check size={14} />{saving ? 'Saving…' : 'Save semester'}</button></>}><Notice>Saving updates your account through the backend. It does not create class records.</Notice><form id="semester-form" className="form-stack" onSubmit={submitSemester}><Field label="Semester name" name="name" placeholder="Enter a semester label" value={semester.name} onChange={(event) => setSemester({ ...semester, name: event.target.value })} required /><div className="form-row"><Field label="Start date" name="start" type="date" value={semester.start} onChange={(event) => setSemester({ ...semester, start: event.target.value })} required /><Field label="End date" name="end" type="date" min={semester.start || undefined} value={semester.end} onChange={(event) => setSemester({ ...semester, end: event.target.value })} required /></div><Field label="Attendance target (%)" name="target" type="number" placeholder="Optional" min="0" max="100" value={semester.target} onChange={(event) => setSemester({ ...semester, target: event.target.value })} /><fieldset className="day-checkboxes"><legend>Working days</legend>{DAYS.map((day) => <label key={day} className="checkbox-label"><input type="checkbox" checked={workingDays.includes(day)} onChange={() => updateWorkingDay(day)} /><span>{day}</span></label>)}</fieldset><div className="optional-days"><span>Include Saturday or Sunday only if you have classes on those days.</span></div>{accountState !== 'ready' && <p className="form-error" role="alert">Sign in and connect to the backend before saving semester details.</p>}{formError && <p className="form-error" role="alert">{formError}</p>}</form></Overlay>}
    {subjectForm && <Overlay title={subjects.some((item) => item.id === subjectForm.id) ? 'Edit subject' : 'Add a subject'} onClose={() => { setSubjectForm(null); setPendingClassDay(null); }} footer={<><button type="button" className="button button-secondary" onClick={() => { setSubjectForm(null); setPendingClassDay(null); }}>Cancel</button><button type="submit" form="subject-form" className="button button-primary" disabled={saving || accountState !== 'ready' || !semester.id}><Check size={14} />{saving ? 'Saving…' : 'Save subject'}</button></>}><Notice>{pendingClassDay !== null ? 'Add this subject first. The class form will open when the subject is saved.' : 'Subject changes are saved to your account through the backend.'}</Notice><form id="subject-form" className="form-stack" onSubmit={submitSubject}><Field label="Subject name" name="name" placeholder="Enter the subject name" value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} required /><Field label="Subject code" name="code" placeholder="Enter the subject code" value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value })} required /><Field label="Attendance target (%)" name="target" type="number" placeholder="Optional" min="0" max="100" value={subjectForm.target} onChange={(event) => setSubjectForm({ ...subjectForm, target: event.target.value })} />{accountState !== 'ready' && <p className="form-error" role="alert">Sign in to load and save account subjects.</p>}{!semester.id && <p className="form-error" role="alert">Set up a semester before adding subjects.</p>}{formError && <p className="form-error" role="alert">{formError}</p>}</form></Overlay>}
    {subjectDeleteTarget && <Overlay title="Delete this subject?" onClose={() => setSubjectDeleteTarget(null)} footer={<><button type="button" className="button button-secondary" onClick={() => setSubjectDeleteTarget(null)}>Keep subject</button><button type="button" className="button button-danger" onClick={confirmSubjectDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete subject'}</button></>}><p className="dialog-copy">Delete <strong>{subjectDeleteTarget.name} ({subjectDeleteTarget.code})</strong> from your account? A subject used by timetable entries cannot be deleted until those entries are handled.</p></Overlay>}
    {entryForm && <Overlay title={editingEntry ? 'Edit timetable entry' : 'Add a recurring class'} wide onClose={() => { setEntryForm(null); setEditingEntry(null); }} footer={<><button type="button" className="button button-secondary" onClick={() => { setEntryForm(null); setEditingEntry(null); }}>Cancel</button><button type="submit" form="entry-form" className="button button-primary" disabled={saving || accountState !== 'ready' || !subjects.length}><Check size={14} />{saving ? 'Saving…' : 'Save entry'}</button></>}><Notice>Entries are saved to your account. Scheduler generation remains unavailable until the scheduler backend is connected.</Notice>{!subjects.length && <p className="form-error" role="status">No subjects are available. Close this window and add a subject from the Subjects panel; a semester must be configured first.</p>}<form id="entry-form" className="form-stack" onSubmit={submitEntry}><SelectField label="Subject" name="subjectId" required value={entryForm.subjectId || ''} onChange={(event) => setEntryForm({ ...entryForm, subjectId: event.target.value })}><option value="">Choose a saved subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} ({subject.code})</option>)}</SelectField><SelectField label="Day" name="day" required value={entryForm.day} onChange={(event) => setEntryForm({ ...entryForm, day: event.target.value })}>{DAYS.filter((day) => workingDays.includes(day)).map((day) => <option key={day}>{day}</option>)}</SelectField><div className="form-row"><Field label="Start time" name="start" type="time" value={entryForm.start} onChange={(event) => setEntryForm({ ...entryForm, start: event.target.value })} required /><Field label="End time" name="end" type="time" value={entryForm.end} onChange={(event) => setEntryForm({ ...entryForm, end: event.target.value })} required /></div><Field label="Room or laboratory" name="room" placeholder="Optional" value={entryForm.room || ''} onChange={(event) => setEntryForm({ ...entryForm, room: event.target.value })} />{formError && <p className="form-error" role="alert">{formError}</p>}</form></Overlay>}
    {deleteTarget && <Overlay title="Remove this timetable entry?" onClose={() => setDeleteTarget(null)} footer={<><button type="button" className="button button-secondary" onClick={() => setDeleteTarget(null)}>Keep entry</button><button type="button" className="button button-danger" onClick={confirmEntryDelete} disabled={saving}>{saving ? 'Removing…' : <><Trash2 size={14} />Remove entry</>}</button></>}><p className="dialog-copy">Remove <strong>{deleteTarget.subject}</strong> from the recurring timetable? If attendance records already reference this class, it will be disabled instead so those records remain intact.</p></Overlay>}
    {holidayOpen && <Overlay title="Add a holiday" onClose={() => setHolidayOpen(false)} footer={<><button type="button" className="button button-secondary" onClick={() => setHolidayOpen(false)}>Cancel</button><button type="submit" form="holiday-form" className="button button-primary" disabled={saving || accountState !== 'ready' || !semester.id}>{saving ? 'Saving…' : <><CalendarPlus size={14} />Confirm holiday</>}</button></>}><Notice>A holiday is a calendar event; it does not delete recurring classes or past records.</Notice><form id="holiday-form" className="form-stack" onSubmit={confirmHoliday}><Field label="Holiday date" name="date" type="date" min={semester.start || undefined} max={semester.end || undefined} value={holiday.date} onChange={(event) => setHoliday({ ...holiday, date: event.target.value })} required /><Field label="Reason" name="reason" placeholder="Optional" value={holiday.reason} onChange={(event) => setHoliday({ ...holiday, reason: event.target.value })} /><div className="holiday-explain">Scheduled classes on this date will be excluded from attendance calculations when occurrence generation is connected.</div>{accountState !== 'ready' && <p className="form-error" role="alert">Sign in and configure a semester before adding holidays.</p>}{formError && <p className="form-error" role="alert">{formError}</p>}</form></Overlay>}
  </>;
}
