import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarCheck, CalendarDays, Check, CheckCheck, CircleX, ClipboardCheck, Clock3, LoaderCircle, ShieldCheck, SquareCheckBig, X } from 'lucide-react';
import { Field, Notice, Overlay, PageHeading, SelectField } from '../App.jsx';
import { ApiError, ApiUnavailableError, hasSessionToken } from '../services/apiClient.js';
import { createHoliday } from '../services/timetableService.js';
import { generateClassOccurrences, getClassOccurrences, submitDailyAttendance } from '../services/attendanceService.js';
import { localDateToday } from '../utils/dateUtils.js';

const statuses = ['Pending', 'Present', 'Absent', 'Cancelled'];

export default function DailyReviewPage() {
  const location = useLocation();
  const notificationDate = new URLSearchParams(location.search).get('date');
  const [date, setDate] = useState(() => new URLSearchParams(globalThis.location.search).get('date') || localDateToday());
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

  useEffect(() => { if (notificationDate) setDate(notificationDate); }, [notificationDate]);

  useEffect(() => {
    let active = true;
    async function loadDay() {
      setSelection([]); setChanges({}); setNotes({}); setNotice(''); setValidation('');
      if (!hasSessionToken()) { setRecords([]); setAccountState('signed-out'); return; }
      setAccountState('loading');
      try {
        const result = await getClassOccurrences(date);
        if (!active) return;
        const loadedRecords = result.records || [];
        setRecords(loadedRecords); setNotes(Object.fromEntries(loadedRecords.filter((item) => item.note).map((item) => [item.id, item.note]))); setAccountState('ready');
      } catch (error) {
        if (!active) return;
        setRecords([]);
        setAccountState(error instanceof ApiError && error.status === 401 ? 'signed-out' : 'error');
        setValidation(error instanceof ApiUnavailableError ? 'Local attendance data could not be loaded.' : error.message);
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
  const reviewRecords = records.filter((record) => record.status === 'Pending');
  const allSelected = reviewRecords.length > 0 && selectedCount === reviewRecords.length;
  const proposedChanges = records.filter((record) => (changes[record.id] !== undefined && changes[record.id] !== record.status) || (notes[record.id] || '').trim() !== (record.note || '').trim());
  const canGenerate = accountState === 'ready' && date >= localDateToday();

  function selectAll() { setSelection(allSelected ? [] : reviewRecords.map((item) => item.id)); }
  function applyToSelected(status) {
    setChanges((current) => ({ ...current, ...Object.fromEntries(selection.map((id) => [id, status])) }));
    setNotice(`${selection.length} ${selection.length === 1 ? 'class' : 'classes'} selected as ${status.toLowerCase()}. Review and submit to save.`);
    setSelection([]);
  }
  async function prepareRecords() {
    setBusy(true); setValidation('');
    try {
      const result = await generateClassOccurrences(date);
      const loadedRecords = result.records || []; setRecords(loadedRecords); setChanges({}); setNotes(Object.fromEntries(loadedRecords.filter((item) => item.note).map((item) => [item.id, item.note])));
      const pendingCount = loadedRecords.filter((item) => item.status === 'Pending').length;
      setNotice(result.skipped === 'holiday'
        ? 'This date is marked as a holiday; no Pending records were generated.'
        : result.created > 0
          ? `${result.created} new Pending ${result.created === 1 ? 'record was' : 'records were'} added. Existing attendance records were preserved.`
          : pendingCount > 0
            ? `No new records were needed. ${pendingCount} Pending ${pendingCount === 1 ? 'record is' : 'records are'} ready for review; finalized records were preserved.`
            : 'No new class records were found for this date. Existing finalized records were preserved. Check the selected date and saved timetable.');
    } catch (error) { setValidation(error instanceof ApiUnavailableError ? 'The local scheduler could not generate class records.' : error.message); }
    finally { setBusy(false); }
  }
  async function saveHoliday(event) {
    event.preventDefault(); setValidation('');
    if (!date) { setValidation('Choose a date before marking a holiday.'); return; }
    setBusy(true);
    try {
      await createHoliday({ date, reason: holidayReason.trim() });
      setHolidayOpen(false); setHolidayReason('');
      setNotice('Holiday saved on this device. The recurring timetable remains unchanged.');
      const result = await getClassOccurrences(date); const loadedRecords = result.records || []; setRecords(loadedRecords); setChanges({}); setNotes(Object.fromEntries(loadedRecords.filter((item) => item.note).map((item) => [item.id, item.note])));
    } catch (error) { setValidation(error instanceof ApiUnavailableError ? 'The holiday could not be saved locally.' : error.message); }
    finally { setBusy(false); }
  }
  async function confirmSubmit() {
    if (!proposedChanges.length) { setValidation('There are no attendance changes to submit.'); return; }
    setBusy(true); setValidation('');
    try {
      const result = await submitDailyAttendance({ date, changes: proposedChanges.map((record) => ({ id: record.id, status: changes[record.id] ?? record.status, reason: (notes[record.id] || '').trim() })) });
      setRecords(result.records || []); setChanges({}); setNotes({}); setSelection([]); setSubmitOpen(false);
      setNotice(`${result.changed} ${result.changed === 1 ? 'attendance change was' : 'attendance changes were'} saved on this device.`);
    } catch (error) { setValidation(error instanceof ApiUnavailableError ? 'Your changes could not be saved locally.' : error.message); }
    finally { setBusy(false); }
  }

  return <><PageHeading eyebrow="ATTENDANCE REVIEW" title="Today's Attendance" description="Confirm or correct attendance for a selected day." action={<label className="review-date-picker"><CalendarDays size={15} /><span>Review date</span><input type="date" aria-label="Review date" value={date} onChange={(event) => setDate(event.target.value)} /></label>} />
    {notice && <div className="inline-feedback" role="status"><Check size={15} />{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {validation && !submitOpen && !holidayOpen && <div className="inline-feedback" role={accountState === 'error' ? 'alert' : 'status'}>{validation}{accountState === 'error' && <button type="button" onClick={() => globalThis.dispatchEvent(new Event('attenda:session-change'))}>Retry</button>}<button type="button" aria-label="Dismiss message" onClick={() => setValidation('')}>×</button></div>}
    <section className="daily-banner"><div className="daily-banner-icon"><ClipboardCheck size={21} /></div><div className="daily-banner-copy"><span className="daily-banner-kicker">DAILY ATTENDANCE CHECK-IN</span><h2>End of Day Review</h2><p>Review actual class records for {date || 'your selected date'}.</p></div><span className={`state-pill banner-state${accountState === 'ready' ? ' state-neutral' : ''}`}><span />{accountState === 'ready' ? 'On device' : accountState === 'loading' ? 'Loading' : accountState === 'signed-out' ? 'Local data unavailable' : 'Storage unavailable'}</span></section>
    <div className="daily-stats"><div className="daily-stat"><span className="daily-stat-icon stat-blue"><CalendarDays size={16} /></span><div><strong>{summary.total}</strong><span>Scheduled classes</span></div></div><div className="daily-stat"><span className="daily-stat-icon stat-amber"><Clock3 size={16} /></span><div><strong>{summary.review}</strong><span>Awaiting review</span></div></div><div className="daily-stat"><span className="daily-stat-icon stat-green"><CheckCheck size={16} /></span><div><strong>{summary.finalized}</strong><span>Finalized</span></div></div></div>
    <section className="card daily-panel"><div className="daily-list-heading"><div><span className="card-kicker">YOUR CLASS RECORDS</span><h2>Classes to review <span className="counter-pill">{reviewRecords.length}</span></h2><p>Pending records for {date || 'the selected date'}</p></div><div className="daily-heading-actions">{canGenerate && <button type="button" className="button button-secondary button-small" onClick={prepareRecords} disabled={busy || accountState !== 'ready'}><CalendarCheck size={14} />{busy ? 'Checking…' : 'Get Pending Records'}</button>}<button type="button" className="text-button" disabled={!reviewRecords.length || accountState !== 'ready'} onClick={selectAll}><SquareCheckBig size={15} />{allSelected ? 'Deselect all' : 'Select all'}</button></div></div>
      {accountState === 'loading' && <div className="daily-empty"><div className="daily-empty-icon"><LoaderCircle size={24} /></div><h3>Loading attendance records</h3><p>Checking this device for class records.</p></div>}
      {accountState === 'signed-out' && <div className="daily-empty"><div className="daily-empty-icon"><ShieldCheck size={24} /></div><h3>Local attendance unavailable</h3><p>Class records are stored on this device.</p><span className="daily-empty-status"><span />Local storage unavailable</span></div>}
      {accountState === 'error' && <div className="daily-empty"><div className="daily-empty-icon"><CalendarCheck size={24} /></div><h3>Local attendance storage unavailable</h3><p>{validation || 'Could not load records from local storage.'}</p><button type="button" className="button button-secondary button-small" onClick={() => globalThis.dispatchEvent(new Event('attenda:session-change'))}>Retry</button></div>}
      {accountState === 'ready' && records.length === 0 && <div className="daily-empty"><div className="daily-empty-icon"><CalendarCheck size={24} /></div><h3>No class records for this date</h3><p>No attendance is assumed from the timetable. Use “Get Pending Records” to check the saved timetable for this date.</p><span className="daily-empty-status"><span />No records loaded</span></div>}
      {accountState === 'ready' && records.length > 0 && reviewRecords.length === 0 && <div className="daily-empty"><div className="daily-empty-icon"><CheckCheck size={24} /></div><h3>No classes awaiting review</h3><p>All of today’s class records are finalized. They remain saved in Attendance and Insights; this review list shows only Pending records.</p><span className="daily-empty-status"><span />{summary.finalized} finalized</span></div>}
      {reviewRecords.length > 0 && accountState === 'ready' && <><div className="daily-class-list">{reviewRecords.map((record) => { const status = changes[record.id] ?? record.status; return <article className={`daily-class-row${selection.includes(record.id) ? ' row-selected' : ''}`} key={record.id}><input type="checkbox" aria-label={`Select ${record.subject}`} checked={selection.includes(record.id)} onChange={() => setSelection((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])} /><div className="class-row-icon"><CalendarDays size={16} /></div><div className="class-row-info"><strong>{record.subject}</strong><span>{record.code} · {record.start}–{record.end}{record.room ? ` · ${record.room}` : ''}</span></div><SelectField label="Attendance status" value={status} onChange={(event) => setChanges((current) => ({ ...current, [record.id]: event.target.value }))}>{statuses.map((item) => <option key={item}>{item}</option>)}</SelectField><Field label="Note or correction reason" maxLength={500} value={notes[record.id] || ''} placeholder="Optional" onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} /></article>; })}</div>
      <div className="bulk-bar"><span>{selectedCount ? `${selectedCount} selected` : 'Select one or more classes'}{proposedChanges.length ? ` · ${proposedChanges.length} unsaved changes` : ''}</span><div className="bulk-actions">{selectedCount > 0 && <button type="button" className="button button-quiet button-small" onClick={() => setSelection([])}>Clear selection</button>}<button type="button" className="button button-present button-small" disabled={!selectedCount} onClick={() => applyToSelected('Present')}><Check size={14} />Mark present</button><button type="button" className="button button-absent button-small" disabled={!selectedCount} onClick={() => applyToSelected('Absent')}><CircleX size={14} />Mark absent</button><button type="button" className="button button-cancelled button-small" disabled={!selectedCount} onClick={() => applyToSelected('Cancelled')}><X size={14} />Mark cancelled</button><button type="button" className="button button-secondary button-small" onClick={() => { setHolidayOpen(true); setValidation(''); }}><CalendarDays size={14} />Mark holiday</button></div></div></>}
      {accountState === 'ready' && reviewRecords.length === 0 && <div className="bulk-bar bulk-bar-empty"><span>0 classes selected</span><div className="bulk-actions"><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => { setHolidayOpen(true); setValidation(''); }}><CalendarDays size={14} />Mark day as holiday</button></div></div>}
    </section>
    <section className="card submission-card"><div className="submission-icon"><ShieldCheck size={18} /></div><div className="submission-copy"><h2>Ready to submit attendance?</h2><p>{proposedChanges.length ? `${proposedChanges.length} proposed record changes are still unsaved.` : 'Review proposed changes before saving them on this device.'}</p></div><button type="button" className="button button-primary" disabled={accountState !== 'ready' || !proposedChanges.length || busy} onClick={() => { setSubmitOpen(true); setValidation(''); }}><ClipboardCheck size={15} />Submit attendance</button></section>
    <div className="status-legend"><span><i className="legend-dot legend-pending" />Pending — waiting for confirmation</span><span><i className="legend-dot legend-present" />Present — attended</span><span><i className="legend-dot legend-absent" />Absent — confirmed absent</span><span><i className="legend-dot legend-cancelled" />Cancelled — class did not take place</span></div>
    {holidayOpen && <Overlay title="Mark day as a holiday" onClose={() => { setHolidayOpen(false); setValidation(''); }} footer={<><button type="button" className="button button-secondary" onClick={() => setHolidayOpen(false)}>Cancel</button><button type="submit" form="daily-holiday-form" className="button button-primary" disabled={busy || accountState !== 'ready'}>{busy ? 'Saving…' : <><CalendarDays size={14} />Confirm holiday</>}</button></>}><Notice>A holiday is a calendar event. It preserves your recurring timetable and historical records.</Notice><p className="dialog-copy">Selected date: <strong>{date || 'Choose a date above'}</strong></p><form id="daily-holiday-form" className="form-stack" onSubmit={saveHoliday}><Field label="Optional holiday reason" value={holidayReason} placeholder="For example, a campus closure" onChange={(event) => setHolidayReason(event.target.value)} />{validation && <p className="form-error" role="alert">{validation}</p>}</form></Overlay>}
    {submitOpen && <Overlay title="Review attendance submission" onClose={() => { setSubmitOpen(false); setValidation(''); }} footer={<><button type="button" className="button button-secondary" onClick={() => setSubmitOpen(false)}>Back to review</button><button type="button" className="button button-primary" onClick={confirmSubmit} disabled={busy}>{busy ? 'Submitting…' : <><ClipboardCheck size={14} />Confirm submission</>}</button></>}><Notice>{proposedChanges.length} record changes will be saved on this device after you confirm.</Notice><div className="submission-review"><span>Records affected</span><strong>{proposedChanges.length}</strong></div>{validation && <p className="form-error" role="alert">{validation}</p>}<p className="dialog-copy">Each status change is saved in local attendance history. The timetable itself is not changed.</p></Overlay>}
  </>;
}
