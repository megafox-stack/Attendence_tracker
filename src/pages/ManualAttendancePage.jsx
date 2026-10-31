import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Check, CheckCheck, ClipboardCheck, FileSpreadsheet, FileText, LoaderCircle, Plus, Trash2, Upload, X } from 'lucide-react';
import { EmptyState, Field, Notice, Overlay, PageHeading, SelectField } from '../App.jsx';
import { hasSessionToken } from '../services/apiClient.js';
import { getSubjects } from '../services/subjectsService.js';
import { getCurrentSemester } from '../services/semesterService.js';
import { clearManualAttendanceDraft, commitManualAttendance, getManualAttendanceDraft, saveManualAttendanceDraft, validateManualAttendance } from '../services/manualAttendanceService.js';
import { guessAttendanceColumns, normalizeImportDate, normalizeImportStatus, parseClassPeriod, readAttendanceImport } from '../utils/attendanceImport.js';
import { localDateToday } from '../utils/dateUtils.js';
import './ManualAttendancePage.css';

const statusOptions = ['Pending', 'Present', 'Absent', 'Cancelled', 'Holiday'];
const idForRow = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const blankForm = () => ({ subjectId: '', date: localDateToday(), start: '', end: '', status: '', note: '' });

function sourceLabel(source) {
  if (source === 'xlsx') return 'Excel import';
  if (source === 'csv') return 'CSV import';
  return 'Manual entry';
}

function columnSelect(label, value, headers, onChange) {
  return <SelectField label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
    <option value="">Choose a column</option>{headers.map((header, index) => <option value={index} key={`${header}-${index}`}>{header}</option>)}
  </SelectField>;
}

export default function ManualAttendancePage() {
  const [semester, setSemester] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [draft, setDraft] = useState([]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [state, setState] = useState(hasSessionToken() ? 'loading' : 'unavailable');
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [confirmReport, setConfirmReport] = useState(null);
  const [importData, setImportData] = useState(null);
  const [importMap, setImportMap] = useState({ subject: null, date: null, period: null, status: null });
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const draftTimer = useRef(null);
  const skipNextDraftSave = useRef(false);
  const fileInput = useRef(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!hasSessionToken()) { setState('unavailable'); setDraftLoaded(true); return; }
      setState('loading');
      try {
        const [currentSemester, subjectRows, stagedRows] = await Promise.all([
          getCurrentSemester(), getSubjects(), getManualAttendanceDraft(),
        ]);
        if (!active) return;
        setSemester(currentSemester); setSubjects(subjectRows); setDraft(Array.isArray(stagedRows) ? stagedRows : []); setState('ready'); setPageError('');
      } catch (error) {
        if (active) { setState('error'); setPageError(error.message || 'Could not load local attendance setup.'); }
      } finally { if (active) setDraftLoaded(true); }
    }
    load();
    return () => { active = false; clearTimeout(draftTimer.current); };
  }, []);

  useEffect(() => {
    if (!draftLoaded || state !== 'ready') return undefined;
    if (skipNextDraftSave.current) { skipNextDraftSave.current = false; return undefined; }
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveManualAttendanceDraft(draft).catch((error) => setPageError(`Staged changes could not be saved on this device: ${error.message}`));
    }, 350);
    return () => clearTimeout(draftTimer.current);
  }, [draft, draftLoaded, state]);

  useEffect(() => {
    if (!draftLoaded || state !== 'ready' || draft.length === 0) { setAnalysis(null); return undefined; }
    let active = true;
    setValidating(true);
    const timer = setTimeout(async () => {
      try { const result = await validateManualAttendance(draft); if (active) setAnalysis(result); }
      catch (error) { if (active) setPageError(error.message || 'Could not validate staged attendance.'); }
      finally { if (active) setValidating(false); }
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [draft, draftLoaded, state]);

  const analysisById = useMemo(() => new Map((analysis?.rows || []).map((row) => [row.id, row])), [analysis]);
  const summary = analysis?.summary || { total: draft.length, valid: 0, invalid: draft.length, duplicates: 0, conflicts: 0, ready: 0, skipped: 0, unresolved: draft.length };
  const manualCount = draft.filter((row) => row.source === 'manual').length;
  const importedCount = draft.length - manualCount;
  const updateCount = draft.filter((row) => row.decision === 'replace').length;
  const skippedCount = draft.filter((row) => row.decision === 'skip').length;

  function stageManual(event) {
    event.preventDefault(); setFormError(''); setNotice('');
    if (!form.date || !form.status) { setFormError('Choose an attendance date and status.'); return; }
    if (form.status !== 'Holiday' && (!form.subjectId || !form.start || !form.end)) { setFormError('Choose a subject and class period.'); return; }
    if (form.status !== 'Holiday' && form.end <= form.start) { setFormError('Class end time must be later than its start time.'); return; }
    setDraft((rows) => [...rows, { id: idForRow(), source: 'manual', subjectId: form.status === 'Holiday' ? '' : form.subjectId, subjectText: '', date: form.date, start: form.status === 'Holiday' ? '' : form.start, end: form.status === 'Holiday' ? '' : form.end, status: form.status, note: form.note.trim(), decision: '' }]);
    setForm((current) => ({ ...current, start: '', end: '', status: '', note: '' }));
    setNotice('Entry added to the staged review list. It has not changed attendance records.');
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError(''); setImportBusy(true); setImportData(null);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a file smaller than 20 MB.');
      const parsed = await readAttendanceImport(file);
      setImportData(parsed); setImportMap(guessAttendanceColumns(parsed.headers));
    } catch (error) { setImportError(error.message || 'Could not read this file.'); }
    finally { setImportBusy(false); }
  }

  function stageImportedRows() {
    if (!importData || Object.values(importMap).some((index) => index === null)) {
      setImportError('Map the Subject, Date, Class period, and Attendance status columns before adding rows.'); return;
    }
    const mapped = importData.rows.map(({ rowNumber, values }) => {
      const subjectText = String(values[importMap.subject] ?? '').trim();
      const subject = subjects.find((item) => item.code.toLowerCase() === subjectText.toLowerCase() || item.name.toLowerCase() === subjectText.toLowerCase());
      const period = parseClassPeriod(values[importMap.period]);
      return {
        id: idForRow(), source: importData.extension, importRow: rowNumber,
        subjectId: subject?.id || '', subjectText, date: normalizeImportDate(values[importMap.date]),
        start: period.start, end: period.end, status: normalizeImportStatus(values[importMap.status]), note: '', decision: '',
      };
    });
    if (draft.length + mapped.length > 500) {
      setImportError('The staged list can contain up to 500 rows. Remove some staged rows or split the import file.'); return;
    }
    setDraft((rows) => [...rows, ...mapped]);
    setImportData(null); setImportError('');
    setNotice(`${mapped.length} imported ${mapped.length === 1 ? 'row was' : 'rows were'} added to staged review. Nothing has been committed.`);
  }

  function updateRow(id, change) { setDraft((rows) => rows.map((row) => row.id === id ? { ...row, ...change } : row)); }
  function removeRow(id) { setDraft((rows) => rows.filter((row) => row.id !== id)); }

  async function prepareConfirmation() {
    if (!draft.length || busy) return;
    setBusy(true); setPageError(''); setConfirmError('');
    try {
      clearTimeout(draftTimer.current);
      await saveManualAttendanceDraft(draft);
      const result = await validateManualAttendance(draft);
      setAnalysis(result);
      if (result.summary.unresolved > 0) {
        setPageError(`Resolve or skip the ${result.summary.unresolved} flagged ${result.summary.unresolved === 1 ? 'row' : 'rows'} before confirming. No attendance records were changed.`);
      } else {
        setConfirmReport(result.summary); setConfirmOpen(true);
      }
    } catch (error) { setPageError(error.message || 'Could not validate the staged changes.'); }
    finally { setBusy(false); }
  }

  async function confirmAndSave() {
    setBusy(true); setConfirmError('');
    try {
      const result = await commitManualAttendance(draft);
      clearTimeout(draftTimer.current); skipNextDraftSave.current = true;
      setDraft([]); setAnalysis(null); setConfirmOpen(false); setConfirmReport(null);
      setNotice(`${result.created + result.updated + result.holidaysCreated + result.holidaysUpdated} attendance ${result.created + result.updated + result.holidaysCreated + result.holidaysUpdated === 1 ? 'change was' : 'changes were'} saved. ${result.skipped} skipped; ${result.pendingCancelledByHoliday} Pending ${result.pendingCancelledByHoliday === 1 ? 'class was' : 'classes were'} cancelled by holiday entries.`);
    } catch (error) { setConfirmError(error.message || 'The batch could not be saved. Staged changes are still available to retry.'); }
    finally { setBusy(false); }
  }

  async function discardDraft() {
    if (!draft.length || !globalThis.confirm('Discard all staged manual and imported rows? This will not delete or change any saved attendance.')) return;
    setBusy(true); setPageError('');
    try {
      clearTimeout(draftTimer.current); await clearManualAttendanceDraft(); skipNextDraftSave.current = true;
      setDraft([]); setAnalysis(null); setNotice('Staged changes discarded. Saved attendance was not changed.');
    } catch (error) { setPageError(error.message || 'Could not discard the staged list.'); }
    finally { setBusy(false); }
  }

  const importPreview = importData?.rows.slice(0, 4) || [];
  const canMapImport = importData && Object.values(importMap).every((index) => index !== null);

  return <>
    <PageHeading eyebrow="ATTENDANCE TOOLS" title="Manual Attendance" description="Enter or import attendance, review every change, then save the complete batch." />
    {notice && <div className="inline-feedback" role="status"><Check size={15} />{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {pageError && <div className="inline-feedback" role="alert"><AlertCircle size={15} />{pageError}<button type="button" aria-label="Dismiss message" onClick={() => setPageError('')}>×</button></div>}
    {state === 'loading' && <section className="card manual-state"><LoaderCircle size={20} /><p>Loading subjects and staged changes from this device…</p></section>}
    {state === 'unavailable' && <section className="card manual-state"><EmptyState icon={ClipboardCheck} title="Open the installed Android app" description="Manual attendance uses the local Room database on this device." /></section>}
    {state === 'error' && <section className="card manual-state" role="alert"><EmptyState icon={AlertCircle} title="Local attendance unavailable" description={pageError || 'The staged data could not be loaded.'} /></section>}
    {state === 'ready' && <>
      {!semester && <Notice tone="warning">Set up a semester and subjects in Timetable & Scheduler before entering attendance.</Notice>}
      <div className="manual-workspace">
        <div className="manual-main-column">
          <section className="card manual-card">
            <div className="manual-card-heading"><span className="manual-card-icon"><Plus size={17} /></span><div><h2>Manual attendance entry</h2><p>Add a record to the review list; it is not saved to attendance yet.</p></div></div>
            <form className="manual-form" onSubmit={stageManual}>
              <SelectField label="Subject" value={form.subjectId} disabled={!semester || form.status === 'Holiday'} required={form.status !== 'Holiday'} onChange={(event) => setForm({ ...form, subjectId: event.target.value })}><option value="">Choose a subject</option>{subjects.filter((subject) => subject.active).map((subject) => <option value={subject.id} key={subject.id}>{subject.name} ({subject.code})</option>)}</SelectField>
              <Field label="Attendance date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required disabled={!semester} />
              {form.status !== 'Holiday' && <div className="form-row"><Field label="Class starts" type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} required disabled={!semester} /><Field label="Class ends" type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} required disabled={!semester} /></div>}
              <SelectField label="Attendance status" value={form.status} required onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="">Choose a status</option>{statusOptions.map((status) => <option key={status}>{status}</option>)}</SelectField>
              <Field label={form.status === 'Holiday' ? 'Holiday reason' : 'Note (optional)'} value={form.note} maxLength={form.status === 'Holiday' ? 240 : 500} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder={form.status === 'Holiday' ? 'Optional reason' : 'Optional note'} />
              {form.status === 'Holiday' && <p className="manual-holiday-note">A holiday is a calendar event. Applying it may cancel Pending records for that date; finalized attendance is preserved.</p>}
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <button type="submit" className="button button-secondary" disabled={!semester || busy}><Plus size={14} />Add to review</button>
            </form>
          </section>

          <section className="card manual-card">
            <div className="manual-card-heading"><span className="manual-card-icon"><Upload size={17} /></span><div><h2>Import from Excel or CSV</h2><p>Choose a file, map its columns, and preview rows before staging.</p></div></div>
            <div className="manual-import-actions"><label className="button button-secondary manual-file-button"><FileSpreadsheet size={15} />Choose .xlsx or .csv<input ref={fileInput} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} disabled={importBusy || busy} /></label>{importBusy && <span className="manual-muted"><LoaderCircle size={14} />Reading file…</span>}</div>
            <p className="manual-muted">Files are parsed on this device. Legacy .xls files are not supported.</p>
            {importError && <p className="form-error" role="alert">{importError}</p>}
            {importData && <div className="manual-import-preview">
              <div className="manual-preview-title"><strong>{importData.fileName}</strong><span>{importData.rows.length} rows{importData.truncated ? ' · first 500 rows shown; split larger files' : ''}</span></div>
              <div className="manual-map-grid">
                {columnSelect('Subject column', importMap.subject, importData.headers, (value) => setImportMap({ ...importMap, subject: value }))}
                {columnSelect('Date column', importMap.date, importData.headers, (value) => setImportMap({ ...importMap, date: value }))}
                {columnSelect('Class period column', importMap.period, importData.headers, (value) => setImportMap({ ...importMap, period: value }))}
                {columnSelect('Attendance status column', importMap.status, importData.headers, (value) => setImportMap({ ...importMap, status: value }))}
              </div>
              <div className="manual-table-wrap"><table className="manual-preview-table"><thead><tr>{importData.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{importPreview.map((row) => <tr key={row.rowNumber}>{row.values.map((value, index) => <td key={index}>{String(value ?? '') || '—'}</td>)}</tr>)}</tbody></table></div>
              <div className="manual-preview-footer"><span>Map a period as a time range, for example 09:00–10:00. You can correct staged rows before saving.</span><button type="button" className="button button-primary button-small" disabled={!canMapImport || busy} onClick={stageImportedRows}><Plus size={13} />Add rows to review</button></div>
            </div>}
          </section>
        </div>

        <aside className="manual-aside">
          <section className="card manual-summary-card"><span className="card-kicker">BATCH REVIEW</span><h2>{draft.length} staged {draft.length === 1 ? 'change' : 'changes'}</h2><p>Staged rows are stored separately from confirmed attendance.</p>
            <div className="manual-summary-grid"><div><strong>{summary.total}</strong><span>Total rows</span></div><div><strong>{summary.valid}</strong><span>Valid</span></div><div><strong>{summary.invalid}</strong><span>Invalid</span></div><div><strong>{summary.duplicates}</strong><span>Duplicates</span></div><div><strong>{summary.conflicts}</strong><span>Conflicts</span></div><div><strong>{summary.ready}</strong><span>Ready</span></div></div>
            <div className="manual-summary-sources"><span>Manual entries <b>{manualCount}</b></span><span>Imported rows <b>{importedCount}</b></span><span>Updates <b>{updateCount}</b></span><span>Skipped <b>{skippedCount}</b></span></div>
            {validating && <span className="manual-muted"><LoaderCircle size={14} />Checking latest saved records…</span>}
            <div className="manual-summary-actions"><button type="button" className="button button-primary manual-confirm-button" disabled={!draft.length || busy || validating || state !== 'ready'} onClick={prepareConfirmation}><CheckCheck size={15} />Confirm &amp; Save All Changes</button><button type="button" className="button button-quiet button-small" disabled={!draft.length || busy} onClick={discardDraft}><Trash2 size={14} />Discard staged changes</button></div>
          </section>
          <Notice>Only confirmed changes enter the shared attendance database. Home, Attendance history, and subject totals update after a successful batch save.</Notice>
        </aside>
      </div>

      <section className="card manual-staged-section">
        <div className="manual-card-heading"><span className="manual-card-icon"><ClipboardCheck size={17} /></span><div><h2>Review staged changes</h2><p>Correct invalid rows and explicitly resolve conflicts before confirming.</p></div></div>
        {!draft.length ? <EmptyState icon={FileText} title="No staged changes" description="Add a manual entry or import a CSV/XLSX file to begin." /> : <>
          {draft.map((row) => {
            const checked = analysisById.get(row.id);
            const conflict = checked?.conflict && checked.conflict !== null ? checked.conflict : null;
            const options = conflict?.options || [];
            const holiday = row.status === 'Holiday';
            return <article className={`manual-staged-row${checked?.invalid ? ' staged-invalid' : ''}${conflict ? ' staged-conflict' : ''}`} key={row.id}>
              <div className="manual-staged-top"><span className="manual-source-pill">{row.source === 'manual' ? <ClipboardCheck size={12} /> : row.source === 'xlsx' ? <FileSpreadsheet size={12} /> : <FileText size={12} />}{sourceLabel(row.source)}{row.importRow ? ` · row ${row.importRow}` : ''}</span><button type="button" className="icon-button" aria-label="Remove staged row" title="Remove staged row" onClick={() => removeRow(row.id)} disabled={busy}><X size={15} /></button></div>
              <div className="manual-staged-grid">
                {!holiday && <SelectField label="Subject" value={row.subjectId || ''} onChange={(event) => updateRow(row.id, { subjectId: event.target.value, subjectText: '' })}><option value="">Choose subject{row.subjectText ? ` · ${row.subjectText}` : ''}</option>{subjects.filter((subject) => subject.active).map((subject) => <option value={subject.id} key={subject.id}>{subject.name} ({subject.code})</option>)}</SelectField>}
                <Field label="Date" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : ''} onChange={(event) => updateRow(row.id, { date: event.target.value, decision: '' })} />
                {!holiday && <><Field label="Start" type="time" value={/^\d{2}:\d{2}$/.test(row.start) ? row.start : ''} onChange={(event) => updateRow(row.id, { start: event.target.value, decision: '' })} /><Field label="End" type="time" value={/^\d{2}:\d{2}$/.test(row.end) ? row.end : ''} onChange={(event) => updateRow(row.id, { end: event.target.value, decision: '' })} /></>}
                <SelectField label="Status" value={statusOptions.includes(row.status) ? row.status : ''} onChange={(event) => updateRow(row.id, { status: event.target.value, decision: '' })}><option value="">Choose status</option>{statusOptions.map((status) => <option key={status}>{status}</option>)}</SelectField>
                <Field label={holiday ? 'Holiday reason' : 'Note'} value={row.note || ''} maxLength={holiday ? 240 : 500} onChange={(event) => updateRow(row.id, { note: event.target.value })} />
                {(conflict || checked?.invalid) && <SelectField label="Resolve row" value={row.decision || ''} onChange={(event) => updateRow(row.id, { decision: event.target.value })}><option value="">Choose an action</option>{options.map((option) => <option value={option} key={option}>{option === 'replace' ? 'Replace existing status' : option === 'allow' ? 'Keep both records' : option === 'apply' ? 'Apply holiday and cancel Pending' : 'Skip this row'}</option>)}{checked?.invalid && !options.includes('skip') && <option value="skip">Skip this row</option>}</SelectField>}
              </div>
              {row.subjectText && !row.subjectId && !holiday && <p className="manual-row-note">Imported subject value: {row.subjectText}. Select the matching saved subject.</p>}
              {checked?.problems?.length > 0 && <p className="manual-row-warning"><AlertCircle size={14} />{checked.problems.join(' ')}</p>}
              {conflict && <p className="manual-row-warning"><AlertCircle size={14} />{conflict.message}{checked.existingStatus ? ` Current status: ${checked.existingStatus}.` : ''}</p>}
              {row.decision === 'skip' && <p className="manual-row-skipped">This row will be skipped; existing attendance will stay unchanged.</p>}
            </article>;
          })}
        </>}
      </section>
    </>}

    {confirmOpen && <Overlay title="Confirm and save attendance?" onClose={() => { if (!busy) { setConfirmOpen(false); setConfirmError(''); } }} footer={<><button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>Review changes</button><button type="button" className="button button-primary" disabled={busy || (confirmReport?.unresolved ?? 1) > 0} onClick={confirmAndSave}><Check size={14} />{busy ? 'Saving batch…' : 'Confirm & Save All Changes'}</button></>}><Notice>All rows are revalidated against the latest Room data and saved in one transaction. If validation or saving fails, no partial batch is committed and your staged list remains.</Notice><div className="manual-confirm-summary"><span>Manual entries <b>{manualCount}</b></span><span>Imported rows <b>{importedCount}</b></span><span>Updates <b>{updateCount}</b></span><span>Skipped <b>{skippedCount}</b></span><span>Unresolved conflicts <b>{confirmReport?.unresolved ?? 0}</b></span></div>{confirmError && <p className="form-error" role="alert">{confirmError}</p>}</Overlay>}
  </>;
}
