import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, Check, CheckCheck, CircleX, ClipboardCheck, Clock3, LoaderCircle, ShieldCheck, SquareCheckBig, X } from 'lucide-react';
import { Field, Notice, Overlay, PageHeading, SelectField } from '../App.jsx';
import { ApiError, ApiUnavailableError, hasSessionToken } from '../services/apiClient.js';
import { createHoliday } from '../services/timetableService.js';
import { generateClassOccurrences, getClassOccurrences, submitDailyAttendance } from '../services/attendanceService.js';
import { localDateToday } from '../utils/dateUtils.js';

const statuses = ['Pending', 'Present', 'Absent', 'Cancelled'];

export default function DailyReviewPage() {
  const [date, setDate] = useState(localDateToday());
  const [selection, setSelection] = useState([]);
  const [changes, setChanges] = useState({});
  const [notes, setNotes] = useState({});
  const [records, setRecords] = useState([]);
  const [accountState, setAccountState] = useState(hasSessionToken() ? 'loading' : 'signed-out');
  const [busy, setBusy] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holidayReason, setHolidayReason] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');

  useEffect(() => {
    let active = true;
    async function loadDay() {
      setSelection([]); setChanges({}); setNotes({}); setNotice(''); setValidation('');
      if (!hasSessionToken()) { setRecords([]); setAccountState('signed-out'); return; }
      setAccountState('loading');
      try {
        const result = await getClassOccurrences(date);
        if (!active) return;
        setRecords(result.records || []); setAccountState('ready');
      } catch (error) {
        if (!active) return;
        setRecords([]);
        setAccountState(error instanceof ApiError && error.status === 401 ? 'signed-out' : 'error');
        setValidation(error instanceof ApiUnavailableError ? 'The attendance backend is not reachable. No class records were loaded.' : error.message);
      }
    }
    loadDay();
    globalThis.addEventListener('attenda:session-change', loadDay);
    return () => { active = false; globalThis.removeEventListener('attenda:session-change', loadDay); };
  }, [date]);

  const summary = useMemo(() => ({
    total: records.length,
    review: records.filter((item) => (changes[item.id] ?? item.status) === 'Pending').length,
    finalized: records.filter((item) => ['Present', 'Absent', 'Cancelled'].includes(changes[item.id] ?? item.status)).length,
  }), [records, changes]);
  const selectedCount = selection.length;
  const allSelected = records.length > 0 && selectedCount === records.length;
  const proposedChanges = records.filter((record) => changes[record.id] !== undefined && changes[record.id] !== record.status);
  const canGenerate = accountState === 'ready' && date >= localDateToday();

  function selectAll() { setSelection(allSelected ? [] : records.map((item) => item.id)); }
  function applyToSelected(status) {
    setChanges((current) => ({ ...current, ...Object.fromEntries(selection.map((id) => [id, status])) }));
    setNotice(`${selection.length} ${selection.length === 1 ? 'class' : 'classes'} selected as ${status.toLowerCase()}. Review and submit to save.`);
    setSelection([]);
  }
  async function prepareRecords() {
    setBusy(true); setValidation('');
    try {
      const result = await generateClassOccurrences(date);
      setRecords(result.records || []); setChanges({}); setNotes({});
      setNotice(result.skipped === 'holiday' ? 'This date is already marked as a holiday; no pending records were generated.' : `${result.created} pending ${result.created === 1 ? 'class record was' : 'class records were'} prepared from your saved timetable.`);
    } catch (error) { setValidation(error instanceof ApiUnavailableError ? 'The backend is not reachable. No class records were generated.' : error.message); }
    finally { setBusy(false); }
  }
  async function saveHoliday(event) {
    event.preventDefault(); setValidation('');
    if (!date) { setValidation('Choose a date before marking a holiday.'); return; }
    setBusy(true);
    try {
      await createHoliday({ date, reason: holidayReason.trim() });
      setHolidayOpen(false); setHolidayReason('');
      setNotice('Holiday saved to your account. The recurring timetable remains unchanged.');
      const result = await getClassOccurrences(date); setRecords(result.records || []); setChanges({}); setNotes({});
    } catch (error) { setValidation(error instanceof ApiUnavailableError ? 'The backend is not reachable. The holiday was not saved.' : error.message); }
    finally { setBusy(false); }
  }
  async function confirmSubmit() {
    if (!proposedChanges.length) { setValidation('There are no attendance changes to submit.'); return; }
    setBusy(true); setValidation('');
    try {
      const result = await submitDailyAttendance({ date, changes: proposedChanges.map((record) => ({ id: record.id, status: changes[record.id], reason: (notes[record.id] || '').trim() })) });
      setRecords(result.records || []); setChanges({}); setNotes({}); setSelection([]); setSubmitOpen(false);
      setNotice(`${result.changed} ${result.changed === 1 ? 'attendance change was' : 'attendance changes were'} saved to your account.`);
    } catch (error) { setValidation(error instanceof ApiUnavailableError ? 'The backend is not reachable. Your changes remain unsaved in this screen.' : error.message); }
    finally { setBusy(false); }
  }

  return <><PageHeading eyebrow="ATTENDANCE REVIEW" title="Today's Attendance" description="Confirm or correct attendance for a selected day." action={<label className="review-date-picker"><CalendarDays size={15} /><span>Review date</span><input type="date" aria-label="Review date" value={date} onChange={(event) => setDate(event.target.value)} /></label>} />
    {notice && <div className="inline-feedback" role="status"><Check size={15} />{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {validation && !submitOpen && !holidayOpen && <div className="inline-feedback" role={accountState === 'error' ? 'alert' : 'status'}>{validation}{accountState === 'error' && <button type="button" onClick={() => globalThis.dispatchEvent(new Event('attenda:session-change'))}>Retry</button>}<button type="button" aria-label="Dismiss message" onClick={() => setValidation('')}>×</button></div>}
    <section className="daily-banner"><div className="daily-banner-icon"><ClipboardCheck size={21} /></div><div className="daily-banner-copy"><span className="daily-banner-kicker">DAILY ATTENDANCE CHECK-IN</span><h2>End of Day Review</h2><p>Review actual class records for {date || 'your selected date'}.</p></div><span className={`state-pill banner-state${accountState === 'ready' ? ' state-neutral' : ''}`}><span />{accountState === 'ready' ? 'Connected' : accountState === 'loading' ? 'Loading' : accountState === 'signed-out' ? 'Sign in required' : 'Backend unavailable'}</span></section>
    <div className="daily-stats"><div className="daily-stat"><span className="daily-stat-icon stat-blue"><CalendarDays size={16} /></span><div><strong>{summary.total}</strong><span>Scheduled classes</span></div></div><div className="daily-stat"><span className="daily-stat-icon stat-amber"><Clock3 size={16} /></span><div><strong>{summary.review}</strong><span>Awaiting review</span></div></div><div className="daily-stat"><span className="daily-stat-icon stat-green"><CheckCheck size={16} /></span><div><strong>{summary.finalized}</strong><span>Finalized</span></div></div></div>
    <section className="card daily-panel"><div className="daily-list-heading"><div><span className="card-kicker">YOUR CLASS RECORDS</span><h2>Attendance records <span className="counter-pill">{summary.total}</span></h2><p>Records for {date || 'the selected date'}</p></div><button type="button" className="text-button" disabled={!records.length || accountState !== 'ready'} onClick={selectAll}><SquareCheckBig size={15} />{allSelected ? 'Deselect all' : 'Select all'}</button></div>
      {accountState === 'loading' && <div className="daily-empty"><div className="daily-empty-icon"><LoaderCircle size={24} /></div><h3>Loading attendance records</h3><p>Checking your account for this date.</p></div>}
      {accountState === 'signed-out' && <div className="daily-empty"><div className="daily-empty-icon"><ShieldCheck size={24} /></div><h3>Sign in to review attendance</h3><p>Class records belong to your account and are not stored on this device.</p><span className="daily-empty-status"><span />Not signed in</span></div>}
      {accountState === 'error' && <div className="daily-empty"><div className="daily-empty-icon"><CalendarCheck size={24} /></div><h3>Attendance service unavailable</h3><p>{validation || 'Could not load records from the backend.'}</p><button type="button" className="button button-secondary button-small" onClick={() => globalThis.dispatchEvent(new Event('attenda:session-change'))}>Retry</button></div>}
      {accountState === 'ready' && records.length === 0 && <div className="daily-empty"><div className="daily-empty-icon"><CalendarCheck size={24} /></div><h3>No class records for this date</h3><p>No attendance is assumed from the timetable. You can explicitly prepare Pending records from saved timetable entries for today or a future working day.</p><span className="daily-empty-status"><span />No records loaded</span>{canGenerate && <button type="button" className="button button-secondary button-small" onClick={prepareRecords} disabled={busy}><CalendarCheck size={14} />{busy ? 'Preparing…' : 'Prepare Pending records'}</button>}</div>}
      {records.length > 0 && accountState === 'ready' && <><div className="daily-class-list">{records.map((record) => { const status = changes[record.id] ?? record.status; return <article className={`daily-class-row${selection.includes(record.id) ? ' row-selected' : ''}`} key={record.id}><input type="checkbox" aria-label={`Select ${record.subject}`} checked={selection.includes(record.id)} onChange={() => setSelection((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])} /><div className="class-row-icon"><CalendarDays size={16} /></div><div className="class-row-info"><strong>{record.subject}</strong><span>{record.code} · {record.start}–{record.end}{record.room ? ` · ${record.room}` : ''}</span></div><SelectField label="Attendance status" value={status} onChange={(event) => setChanges((current) => ({ ...current, [record.id]: event.target.value }))}>{statuses.map((item) => <option key={item}>{item}</option>)}</SelectField><Field label="Note or correction reason" maxLength={500} value={notes[record.id] || ''} placeholder="Optional" onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} /></article>; })}</div>
      <div className="bulk-bar"><span>{selectedCount ? `${selectedCount} selected` : 'Select one or more classes'}{proposedChanges.length ? ` · ${proposedChanges.length} unsaved changes` : ''}</span><div className="bulk-actions">{selectedCount > 0 && <button type="button" className="button button-quiet button-small" onClick={() => setSelection([])}>Clear selection</button>}<button type="button" className="button button-present button-small" disabled={!selectedCount} onClick={() => applyToSelected('Present')}><Check size={14} />Mark present</button><button type="button" className="button button-absent button-small" disabled={!selectedCount} onClick={() => applyToSelected('Absent')}><CircleX size={14} />Mark absent</button><button type="button" className="button button-cancelled button-small" disabled={!selectedCount} onClick={() => applyToSelected('Cancelled')}><X size={14} />Mark cancelled</button><button type="button" className="button button-secondary button-small" onClick={() => { setHolidayOpen(true); setValidation(''); }}><CalendarDays size={14} />Mark holiday</button></div></div></>}
      {accountState === 'ready' && records.length === 0 && <div className="bulk-bar bulk-bar-empty"><span>0 classes selected</span><div className="bulk-actions"><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => { setHolidayOpen(true); setValidation(''); }}><CalendarDays size={14} />Mark day as holiday</button></div></div>}
    </section>
    <section className="card submission-card"><div className="submission-icon"><ShieldCheck size={18} /></div><div className="submission-copy"><h2>Ready to submit attendance?</h2><p>{proposedChanges.length ? `${proposedChanges.length} proposed record changes are still unsaved.` : 'Review your proposed changes before sending them to your account.'}</p></div><button type="button" className="button button-primary" disabled={accountState !== 'ready' || !proposedChanges.length || busy} onClick={() => { setSubmitOpen(true); setValidation(''); }}><ClipboardCheck size={15} />Submit attendance</button></section>
    <div className="status-legend"><span><i className="legend-dot legend-pending" />Pending — waiting for confirmation</span><span><i className="legend-dot legend-present" />Present — attended</span><span><i className="legend-dot legend-absent" />Absent — confirmed absent</span><span><i className="legend-dot legend-cancelled" />Cancelled — class did not take place</span></div>
    {holidayOpen && <Overlay title="Mark day as a holiday" onClose={() => { setHolidayOpen(false); setValidation(''); }} footer={<><button type="button" className="button button-secondary" onClick={() => setHolidayOpen(false)}>Cancel</button><button type="submit" form="daily-holiday-form" className="button button-primary" disabled={busy || accountState !== 'ready'}>{busy ? 'Saving…' : <><CalendarDays size={14} />Confirm holiday</>}</button></>}><Notice>A holiday is a calendar event. It preserves your recurring timetable and historical records.</Notice><p className="dialog-copy">Selected date: <strong>{date || 'Choose a date above'}</strong></p><form id="daily-holiday-form" className="form-stack" onSubmit={saveHoliday}><Field label="Optional holiday reason" value={holidayReason} placeholder="For example, a campus closure" onChange={(event) => setHolidayReason(event.target.value)} />{validation && <p className="form-error" role="alert">{validation}</p>}</form></Overlay>}
    {submitOpen && <Overlay title="Review attendance submission" onClose={() => { setSubmitOpen(false); setValidation(''); }} footer={<><button type="button" className="button button-secondary" onClick={() => setSubmitOpen(false)}>Back to review</button><button type="button" className="button button-primary" onClick={confirmSubmit} disabled={busy}>{busy ? 'Submitting…' : <><ClipboardCheck size={14} />Confirm submission</>}</button></>}><Notice>{proposedChanges.length} record changes will be sent to the server. They are not saved until you confirm.</Notice><div className="submission-review"><span>Records affected</span><strong>{proposedChanges.length}</strong></div>{validation && <p className="form-error" role="alert">{validation}</p>}<p className="dialog-copy">The server records each status change in the attendance history. The timetable itself is not changed.</p></Overlay>}
  </>;
}
