import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ImageUp, Plus, Trash2, UsersRound } from 'lucide-react';
import { Field, Notice, Overlay, SelectField } from '../App.jsx';
import { getCurrentSemester } from '../services/semesterService.js';
import { getSubjects } from '../services/subjectsService.js';
import { clearTimetable, importTimetable } from '../services/timetableService.js';
import { pickTimetableImage } from '../services/localAttendanceRepository.js';
import { matchSubjectName, parseTimetableOcr } from '../utils/timetableOcr.js';
import { DAYS } from '../utils/dateUtils.js';
import './TimetableImportModal.css';

const reviewId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyClass = (day = 'Monday') => ({ reviewId: reviewId(), day, subjectName: '', subjectId: '', start: '', end: '', room: '', newSubject: null });

export default function TimetableImportModal({ onClose, onImported = () => {} }) {
  const [semester, setSemester] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkSubjectId, setBulkSubjectId] = useState('');
  const [bulkNewSubject, setBulkNewSubject] = useState({ name: '', code: '' });
  const [hasImage, setHasImage] = useState(false);
  const [detectedDates, setDetectedDates] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [modeToConfirm, setModeToConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([getCurrentSemester(), getSubjects()]).then(([current, saved]) => {
      if (!live) return;
      setSemester(current);
      setSubjects(saved || []);
    }).catch((requestError) => { if (live) setError(requestError.message || 'Could not load this semester and its subjects.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const workingDays = useMemo(() => (semester?.workingDays || DAYS).filter((day) => DAYS.includes(day)), [semester]);
  const unresolvedCount = entries.filter((entry) => !entry.subjectId && !entry.newSubject).length;
  const selectedCount = entries.filter((entry) => selectedIds.has(entry.reviewId)).length;
  const canImport = entries.length > 0 && unresolvedCount === 0 && entries.every((entry) => workingDays.includes(entry.day) && entry.start && entry.end && entry.end > entry.start);

  async function selectImage() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await pickTimetableImage();
      if (result.cancelled) return;
      const parsed = parseTimetableOcr(result.lines || []);
      const mapped = parsed.entries.map((entry) => {
        const match = matchSubjectName(entry.subjectName, subjects);
        return { ...entry, reviewId: reviewId(), subjectId: match?.id || '', newSubject: null };
      });
      setHasImage(true); setEntries(mapped); setSelectedIds(new Set()); setBulkSubjectId(''); setBulkNewSubject({ name: '', code: '' }); setWarnings(parsed.warnings); setDetectedDates(parsed.detectedDates);
      if (!mapped.length && parsed.warnings.length === 0) setWarnings(['No class entries were found in this image. Try a clearer, straight-on photo.']);
      if (mapped.length) setMessage(`Read ${mapped.length} possible class ${mapped.length === 1 ? 'entry' : 'entries'}. Check every row before importing.`);
    } catch (requestError) { setError(requestError.message || 'Could not read the timetable image.'); }
    finally { setBusy(false); }
  }

  function updateEntry(index, changes) {
    setEntries((current) => current.map((entry, i) => i === index ? { ...entry, ...changes } : entry));
  }

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyBulkSubject() {
    const subject = subjects.find((item) => item.id === bulkSubjectId);
    if (!subject || selectedCount === 0) return;
    setError('');
    setEntries((current) => current.map((entry) => selectedIds.has(entry.reviewId)
      ? { ...entry, subjectId: subject.id, subjectName: subject.name, newSubject: null }
      : entry));
    setMessage(`Applied ${subject.name} to ${selectedCount} selected ${selectedCount === 1 ? 'class' : 'classes'} in this review.`);
  }

  function applyBulkNewSubject() {
    const name = bulkNewSubject.name.trim();
    const code = bulkNewSubject.code.trim().toUpperCase();
    if (!selectedCount) { setError('Select one or more classes first.'); return; }
    if (!name || !code) { setError('Enter both the new subject name and code.'); return; }
    if (name.length > 160 || code.length > 40) { setError('Subject name must be 160 characters or fewer, and code must be 40 characters or fewer.'); return; }
    const existing = subjects.find((item) => item.code.trim().toLowerCase() === code.toLowerCase());
    if (existing && existing.name.trim().toLowerCase() !== name.toLowerCase()) {
      setError(`Subject code ${code} already belongs to ${existing.name}. Choose that subject or use another code.`);
      return;
    }
    setError('');
    if (existing) {
      setBulkSubjectId(existing.id);
      setEntries((current) => current.map((entry) => selectedIds.has(entry.reviewId)
        ? { ...entry, subjectId: existing.id, subjectName: existing.name, newSubject: null }
        : entry));
      setMessage(`Applied the existing subject ${existing.name} to ${selectedCount} selected ${selectedCount === 1 ? 'class' : 'classes'}.`);
    } else {
      setEntries((current) => current.map((entry) => selectedIds.has(entry.reviewId)
        ? { ...entry, subjectId: '', subjectName: name, newSubject: { name, code } }
        : entry));
      setMessage(`Prepared ${name} for ${selectedCount} selected ${selectedCount === 1 ? 'class' : 'classes'}. It will be created once when you confirm the timetable import.`);
    }
  }

  async function confirmImport() {
    if (!canImport || busy) return;
    setBusy(true); setError('');
    try {
      const rows = entries.map((entry) => ({ day: entry.day, start: entry.start, end: entry.end, room: entry.room,
        ...(entry.newSubject ? { newSubject: entry.newSubject } : { subjectId: entry.subjectId }) }));
      const result = await importTimetable(modeToConfirm, rows);
      const text = `${result.added} class ${result.added === 1 ? 'entry' : 'entries'} added${result.skippedDuplicates ? `; ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped` : ''}${result.preservedPending ? `; ${result.preservedPending} Pending record${result.preservedPending === 1 ? '' : 's'} kept` : ''}.`;
      setMessage(text); setModeToConfirm(''); setEntries([]); setHasImage(false); setWarnings([]); setDetectedDates([]); onImported(text);
    } catch (requestError) { setError(requestError.message || 'The timetable was not changed. Review the classes and try again.'); }
    finally { setBusy(false); }
  }

  if (loading) return <Overlay title="Upload timetable" onClose={onClose}><p className="settings-modal-status">Loading the current semester…</p></Overlay>;
  return <>
    <Overlay title="Upload timetable image" onClose={busy ? () => {} : onClose} wide footer={<button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Close</button>}>
      <p className="timetable-import-intro">Choose a clear JPG or PNG photo. Text recognition runs on this device. Review every suggested class before anything is added.</p>
      {semester ? <Notice>Importing into <strong>{semester.name}</strong>. Extracted date labels are informational; saved classes repeat weekly.</Notice> : <Notice tone="warning">Set up a semester before importing timetable classes.</Notice>}
      <button type="button" className="button button-primary" onClick={selectImage} disabled={busy || !semester}><ImageUp size={15} />{busy ? 'Reading timetable…' : 'Choose JPG or PNG'}</button>
      {detectedDates.length > 0 && <p className="timetable-import-dates">Date text detected: {detectedDates.join(' · ')}. The recurring timetable stores weekdays and times; dates are not saved as class occurrences.</p>}
      {warnings.map((warning) => <p className="timetable-import-warning" key={warning}><AlertCircle size={14} />{warning}</p>)}
      {message && <p className="settings-modal-status" role="status">{message}</p>}
      {error && <p className="settings-modal-status settings-modal-error" role="alert">{error}</p>}
      {(entries.length > 0 || hasImage) && <>
        <div className="timetable-import-list-heading"><div><strong>Review classes</strong><small>{entries.length} suggested · {unresolvedCount} need a subject match</small></div><button type="button" className="button button-secondary button-small" onClick={() => setEntries((current) => [...current, emptyClass(workingDays[0] || 'Monday')])}><Plus size={14} />Add class</button></div>
        <section className="timetable-bulk-panel" aria-label="Bulk class actions">
          <div className="timetable-bulk-heading"><div><strong><UsersRound size={14} />Bulk subject actions</strong><small>{selectedCount} selected · changes remain in this review until import is confirmed</small></div><div className="timetable-bulk-selection"><button type="button" onClick={() => setSelectedIds(new Set(entries.map((entry) => entry.reviewId)))} disabled={!entries.length}>Select all</button><button type="button" onClick={() => setSelectedIds(new Set())} disabled={!selectedCount}>Clear</button></div></div>
          <div className="timetable-bulk-row"><SelectField label="Apply saved subject" value={bulkSubjectId} onChange={(event) => setBulkSubjectId(event.target.value)} disabled={!subjects.length}><option value="">Choose a subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} ({subject.code})</option>)}</SelectField><button type="button" className="button button-secondary button-small" onClick={applyBulkSubject} disabled={!selectedCount || !bulkSubjectId}>Apply to selected</button></div>
          <div className="timetable-bulk-row timetable-bulk-new"><Field label="New subject name" value={bulkNewSubject.name} onChange={(event) => setBulkNewSubject((current) => ({ ...current, name: event.target.value }))} placeholder="Subject name" /><Field label="Subject code" value={bulkNewSubject.code} onChange={(event) => setBulkNewSubject((current) => ({ ...current, code: event.target.value }))} placeholder="Code" /><button type="button" className="button button-secondary button-small" onClick={applyBulkNewSubject} disabled={!selectedCount || !bulkNewSubject.name.trim() || !bulkNewSubject.code.trim()}><Plus size={14} />Use for selected</button></div>
        </section>
        {!entries.length && <p className="timetable-import-intro">No rows were recognized. You can add the timetable classes manually below.</p>}
        <div className="timetable-import-list">{entries.map((entry, index) => <article className={`timetable-import-row${selectedIds.has(entry.reviewId) ? ' timetable-import-row-selected' : ''}`} key={entry.reviewId}>
          <div className="timetable-import-row-top"><label className="timetable-import-select"><input type="checkbox" checked={selectedIds.has(entry.reviewId)} onChange={() => toggleSelected(entry.reviewId)} aria-label={`Select class ${index + 1} for bulk actions`} /><strong>Class {index + 1}</strong></label><button type="button" className="icon-button" aria-label={`Remove class ${index + 1}`} onClick={() => { setEntries((current) => current.filter((_, i) => i !== index)); setSelectedIds((current) => { const next = new Set(current); next.delete(entry.reviewId); return next; }); }}><Trash2 size={14} /></button></div>
          <SelectField label="Day" value={entry.day} onChange={(event) => updateEntry(index, { day: event.target.value })}>{DAYS.map((day) => <option key={day} value={day} disabled={!workingDays.includes(day)}>{workingDays.includes(day) ? day : `${day} (not enabled)`}</option>)}</SelectField>
          <SelectField label="Subject" value={entry.newSubject ? '__new__' : entry.subjectId} onChange={(event) => {
            const selected = event.target.value;
            updateEntry(index, selected === '__new__' ? { subjectId: '', newSubject: { name: entry.subjectName, code: '' } } : { subjectId: selected, newSubject: null, subjectName: subjects.find((subject) => subject.id === selected)?.name || entry.subjectName });
          }}>
            <option value="">Choose a saved subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} ({subject.code})</option>)}<option value="__new__">Add a new subject</option>
          </SelectField>
          {entry.newSubject && <div className="timetable-new-subject"><Field label="New subject name" value={entry.newSubject.name} onChange={(event) => updateEntry(index, { newSubject: { ...entry.newSubject, name: event.target.value } })} required /><Field label="Subject code" value={entry.newSubject.code} onChange={(event) => updateEntry(index, { newSubject: { ...entry.newSubject, code: event.target.value } })} required /></div>}
          {!entry.subjectId && !entry.newSubject && <Field label="Read subject name" value={entry.subjectName} onChange={(event) => updateEntry(index, { subjectName: event.target.value })} placeholder="Correct the text, then select or add a subject" />}
          <div className="form-row"><Field label="Start" type="time" value={entry.start} onChange={(event) => updateEntry(index, { start: event.target.value })} required /><Field label="End" type="time" value={entry.end} onChange={(event) => updateEntry(index, { end: event.target.value })} required /></div>
          <Field label="Room or laboratory" value={entry.room} onChange={(event) => updateEntry(index, { room: event.target.value })} placeholder="Optional" />
        </article>)}</div>
        <div className="timetable-import-actions"><button type="button" className="button button-secondary" disabled={!canImport || busy} onClick={() => setModeToConfirm('merge')}><Check size={14} />Review merge</button><button type="button" className="button button-primary" disabled={!canImport || busy} onClick={() => setModeToConfirm('replace')}><Check size={14} />Review replace</button></div>
        {!canImport && <p className="form-error">{entries.some((entry) => !workingDays.includes(entry.day)) ? 'Enable the detected class days in the semester setup, then reopen the import.' : 'Choose or add a subject and enter a valid time range for every class.'}</p>}
      </>}
    </Overlay>
    {modeToConfirm && <Overlay title={modeToConfirm === 'replace' ? 'Replace the current timetable?' : 'Merge these classes?'} onClose={() => busy ? null : setModeToConfirm('')} footer={<><button type="button" className="button button-secondary" disabled={busy} onClick={() => setModeToConfirm('')}>Go back</button><button type="button" className={`button ${modeToConfirm === 'replace' ? 'button-danger' : 'button-primary'}`} disabled={busy || !canImport} onClick={confirmImport}>{busy ? 'Applying…' : modeToConfirm === 'replace' ? 'Confirm replace' : 'Confirm merge'}</button></>}>
      <p className="dialog-copy">{modeToConfirm === 'replace' ? 'The current recurring entries will be removed from the active timetable. Historical and reviewed attendance will be kept; eligible future Pending records created by the scheduler may be removed.' : 'Current recurring entries will stay. Exact duplicate classes will be skipped.'}</p>
      <p className="dialog-copy">{entries.length} reviewed classes will be processed. Subject records are reused where matched. This action changes the timetable on this device.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Overlay>}
  </>;
}

export function ClearTimetableDialog({ onClose, onCleared = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function clear() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await clearTimetable();
      const text = `Timetable cleared. ${result.removedPending} scheduler-created future Pending ${result.removedPending === 1 ? 'record was' : 'records were'} removed; ${result.preservedPending} other Pending ${result.preservedPending === 1 ? 'record was' : 'records were'} kept. Historical attendance was retained.`;
      setMessage(text); setCleared(true); onCleared(text);
    } catch (requestError) { setError(requestError.message || 'Could not clear the timetable. No partial changes were kept.'); }
    finally { setBusy(false); }
  }
  return <Overlay title="Clear this timetable?" onClose={busy ? () => {} : onClose} footer={<><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{cleared ? 'Done' : 'Cancel'}</button><button type="button" className="button button-danger" disabled={busy || cleared} onClick={clear}>{busy ? 'Clearing…' : cleared ? 'Cleared' : <><Trash2 size={14} />Clear timetable</>}</button></>}>
    <p className="dialog-copy">This removes recurring classes from the active timetable and eligible future Pending records created by the scheduler for the current semester.</p>
    <p className="dialog-copy">Subjects, holidays, settings, manually reviewed attendance, and historical attendance are kept. Entries referenced by retained attendance are archived so those records remain valid.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <Notice tone="success">{message}</Notice>}
  </Overlay>;
}
