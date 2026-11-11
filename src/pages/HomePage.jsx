import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Bell, Bug, CalendarDays, ChevronRight, CircleHelp, Clock3, Gauge, ListChecks, Settings2, ShieldCheck, TrendingUp, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, Overlay, PageHeading, SectionTitle } from '../App.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { hasSessionToken } from '../services/apiClient.js';
import { getDashboardStatistics, resetAttendanceRecords } from '../services/attendanceService.js';
import { getSchedulerStatus } from '../services/schedulerService.js';
import { exportLocalBackup, importLocalBackup } from '../services/backupService.js';
import { getAppLockState, isNativeAppLockAvailable, setAppLockPin, updateAppLock } from '../services/appLockService.js';
import TimetableImportModal, { ClearTimetableDialog } from '../components/TimetableImportModal.jsx';

function Metric({ icon: Icon, label, value, accent = '' }) {
  return <div className="overview-metric"><span className={`metric-icon ${accent}`}><Icon size={16} /></span><span className="metric-text"><small>{label}</small><strong>{value}</strong></span></div>;
}

export default function HomePage({ settingsOpen = false, onSettingsClose = () => {} }) {
  const [dashboard, setDashboard] = useState(null);
  const [scheduler, setScheduler] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [backupError, setBackupError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [appLock, setAppLock] = useState(null);
  const [appLockBusy, setAppLockBusy] = useState(false);
  const [appLockError, setAppLockError] = useState('');
  const [appLockPin, setAppLockPinValue] = useState('');
  const [appLockPinConfirm, setAppLockPinConfirm] = useState('');
  const [appLockPinSetupOpen, setAppLockPinSetupOpen] = useState(false);
  const [timetableImportOpen, setTimetableImportOpen] = useState(false);
  const [clearTimetableOpen, setClearTimetableOpen] = useState(false);
  const [timetableMessage, setTimetableMessage] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!hasSessionToken()) { setDashboard(null); setScheduler(null); setState('signed-out'); return; }
    if (!quiet) setState('loading');
    try {
      const [summary, schedulerResult] = await Promise.all([getDashboardStatistics(), getSchedulerStatus()]);
      setDashboard(summary); setScheduler(schedulerResult.scheduler); setError(''); setState('ready');
    } catch (requestError) { setState('error'); setError(requestError.message || 'Could not load local attendance data.'); }
  }, []);
  useEffect(() => {
    if (!settingsOpen) return;
    getAppLockState().then(setAppLock).catch((error) => setAppLock({ supported: isNativeAppLockAvailable(), enabled: false, biometricEnabled: false, pinEnabled: false, biometricAvailable: false, hasPin: false, error: error.message }));
  }, [settingsOpen]);

  async function saveLockPreferences(changes) {
    if (!appLock || appLockBusy) return;
    setAppLockBusy(true); setAppLockError('');
    try {
      const next = { enabled: changes.enabled ?? appLock.enabled, biometricEnabled: changes.biometricEnabled ?? appLock.biometricEnabled, pinEnabled: changes.pinEnabled ?? appLock.pinEnabled };
      await updateAppLock(next);
      const refreshed = await getAppLockState(); setAppLock(refreshed);
      globalThis.dispatchEvent(new Event('attenda:app-lock-changed'));
    } catch (error) { setAppLockError(error.message || 'Could not update App Lock settings.'); }
    finally { setAppLockBusy(false); }
  }

  async function saveCustomPin(event) {
    event.preventDefault(); if (appLockBusy) return;
    setAppLockBusy(true); setAppLockError('');
    try {
      await setAppLockPin(appLockPin, appLockPinConfirm);
      const refreshed = await getAppLockState(); setAppLock(refreshed); setAppLockPinValue(''); setAppLockPinConfirm('');
      globalThis.dispatchEvent(new Event('attenda:app-lock-changed'));
    } catch (error) { setAppLockError(error.message || 'Could not save the PIN.'); }
    finally { setAppLockBusy(false); }
  }

  function toggleAppLock() {
    if (!appLock) return;
    if (appLock.enabled) { saveLockPreferences({ enabled: false }); return; }
    if (appLock.biometricEnabled || appLock.pinEnabled) { saveLockPreferences({ enabled: true }); return; }
    if (appLock.biometricAvailable) { saveLockPreferences({ enabled: true, biometricEnabled: true }); return; }
    setAppLockError('Set up a custom PIN below before turning on App Lock.');
    setAppLockPinSetupOpen(true);
  }
  useEffect(() => {
    load();
    const refresh = () => load(true);
    globalThis.addEventListener('attenda:session-change', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { clearInterval(timer); globalThis.removeEventListener('attenda:session-change', refresh); };
  }, [load]);

  const summary = dashboard?.summary;
  const hasRecords = Boolean(summary?.total);
  const percentage = summary?.attendancePercent;
  const todaysRecords = dashboard?.todayRecords || [];
  const nextClass = dashboard?.nextClass;
  const schedulerLabel = state !== 'ready' ? 'Not connected' : scheduler?.status === 'error' ? 'Error' : scheduler?.enabled ? 'Active' : scheduler?.configured ? 'Disabled' : 'Setup required';

  async function confirmReset() {
    if (resetPhrase.trim().toUpperCase() !== 'RESET' || resetBusy) return;
    setResetBusy(true); setResetError(''); setResetMessage('');
    try {
      const result = await resetAttendanceRecords();
      setResetOpen(false); setResetPhrase('');
      await load(true);
      const count = Number(result.deletedRecords || 0);
      const changes = Number(result.deletedChanges || 0);
      const schedulerNote = scheduler?.enabled ? ' The scheduler remains enabled and may create today’s scheduled records again on its next check.' : '';
      setResetMessage(`${count} attendance ${count === 1 ? 'record' : 'records'} and ${changes} correction ${changes === 1 ? 'entry' : 'entries'} removed. Your timetable and device settings were kept.${schedulerNote}`);
    } catch (requestError) {
      setResetError(requestError.message || 'Could not reset attendance records. No reset was confirmed.');
    } finally { setResetBusy(false); }
  }

  async function exportBackup() {
    setBackupBusy(true); setBackupError('');
    try { const result = await exportLocalBackup(); if (!result.cancelled) setResetMessage('Local backup exported. Keep the file somewhere safe.'); }
    catch (error) { setBackupError(error.message || 'Could not export the local backup.'); }
    finally { setBackupBusy(false); }
  }

  async function importBackup() {
    if (!globalThis.confirm('Restore replaces all attendance, timetable, subject, holiday, and setting data on this device with the selected backup. Continue?')) return;
    setBackupBusy(true); setBackupError('');
    try {
      const result = await importLocalBackup();
      if (!result.cancelled) { setResetMessage(`Backup restored (${result.imported} saved items).`); await load(true); }
    } catch (error) { setBackupError(error.message || 'Backup restore failed. Existing local data was not replaced.'); }
    finally { setBackupBusy(false); }
  }

  return <><PageHeading eyebrow="YOUR OVERVIEW" title="Welcome" description="Stay consistent. Your attendance builds your future." />
    {resetMessage && <div className="inline-feedback" role="status">{resetMessage}<button type="button" aria-label="Dismiss message" onClick={() => setResetMessage('')}>×</button></div>}
    {backupError && <div className="inline-feedback" role="alert">{backupError}<button type="button" aria-label="Dismiss message" onClick={() => setBackupError('')}>×</button></div>}
    {state === 'error' && <div className="inline-feedback" role="alert">{error}<button type="button" onClick={load}>Retry</button></div>}
    <section className="card overview-card"><div className="overview-top"><div className="overview-copy"><span className="card-kicker">OVERALL ATTENDANCE</span><div className="percentage-line"><strong>{percentage == null ? '—' : `${percentage}%`}</strong><span>{percentage == null ? (state === 'loading' ? 'Loading records' : 'No attendance data') : 'Present / finalized'}</span></div><p>{hasRecords ? `${summary.finalized} finalized classes. Pending and cancelled records are excluded from the percentage.` : 'Your summary will appear when local class records are generated and reviewed.'}</p></div><div className={`progress-ring${percentage == null ? ' ring-empty' : ''}`} style={percentage == null ? undefined : { background: `conic-gradient(#2678fc ${percentage * 3.6}deg,#eaf2fb ${percentage * 3.6}deg 360deg)` }} role="img" aria-label={percentage == null ? 'No attendance data' : `${percentage}% attendance`}><div><Gauge size={21} /><span>{percentage == null ? '—' : `${percentage}%`}</span></div></div></div>
      <div className="overview-divider" /><div className="metrics-grid"><Metric icon={TrendingUp} label="Present" value={hasRecords ? summary.Present : '—'} accent="metric-green" /><Metric icon={CircleHelp} label="Absent" value={hasRecords ? summary.Absent : '—'} accent="metric-red" /><Metric icon={Clock3} label="Pending" value={hasRecords ? summary.Pending : '—'} accent="metric-amber" /><Metric icon={CalendarDays} label="Cancelled" value={hasRecords ? summary.Cancelled : '—'} accent="metric-slate" /></div></section>
    <div className="home-columns"><div className="stack-column"><section className="card scheduler-home"><div className="scheduler-symbol"><CalendarDays size={19} /></div><div className="scheduler-copy"><div className="card-title-line"><h2>Automatic scheduler</h2><span className="state-pill state-neutral"><span />{schedulerLabel}</span></div><p>{scheduler?.enabled ? 'Android creates Pending records from your timetable. Background runs may be delayed by Android.' : 'Enable it in Timetable & Scheduler after setting up your semester and weekly classes.'}</p></div><Link className="arrow-link" to="/timetable" aria-label="Open timetable setup"><ChevronRight size={18} /></Link></section>
      <section className="card review-banner"><span className="review-icon"><ListChecks size={19} /></span><div className="review-copy"><strong>End of day review</strong><p>{todaysRecords.filter((record) => record.status === 'Pending').length ? `${todaysRecords.filter((record) => record.status === 'Pending').length} classes awaiting review today.` : 'Review or correct today’s attendance in one place.'}</p></div><Link to="/review" className="text-link">Review <ArrowRight size={14} /></Link></section>
      {hasRecords && <section className="card alert-card"><div className="alert-icon"><Bell size={17} /></div><div><h2>Attendance overview</h2><p>{summary.Pending ? `${summary.Pending} classes are waiting for confirmation.` : 'There are no pending attendance records.'}</p></div><Link className="alert-label" to="/attendance">View records</Link></section>}</div>
      <section className="card today-card"><SectionTitle title="Today's classes" action={<Link to="/review" className="subtle-link">Review <ArrowRight size={14} /></Link>} />
        {state === 'loading' && <EmptyState icon={Clock3} title="Loading today’s records" description="Checking attendance saved on this device." />}
        {state === 'signed-out' && <EmptyState icon={CalendarDays} title="No local profile" description="Set up a semester and timetable on this device to begin." />}
        {state === 'ready' && !todaysRecords.length && <EmptyState icon={CalendarDays} title="No classes to show" description={scheduler?.enabled ? 'No occurrences exist for today. Check your working days, timetable, and scheduler status.' : 'Enable the on-device scheduler after configuring your timetable to create daily class records.'} action={<Link className="button button-secondary button-small" to="/timetable"><Settings2 size={14} />Timetable setup</Link>} />}
        {state === 'ready' && todaysRecords.length > 0 && <div className="home-class-list">{todaysRecords.map((record) => <Link className="home-class-row" to="/review" key={record.id}><span className="home-class-icon"><CalendarDays size={15} /></span><span className="home-class-copy"><strong>{record.subject}</strong><small>{record.code} · {record.start}–{record.end}{record.room ? ` · ${record.room}` : ''}</small></span><StatusBadge status={record.status} /><ChevronRight size={14} /></Link>)}</div>}
      </section></div>
    <section className="card next-card"><div className="next-icon"><Clock3 size={18} /></div><div className="next-copy"><span className="card-kicker">UP NEXT</span><h2>{nextClass ? nextClass.subject : 'No upcoming class record'}</h2><p>{nextClass ? `${nextClass.start}–${nextClass.end} · ${nextClass.code}${nextClass.room ? ` · ${nextClass.room}` : ''}` : 'Next class appears here after a scheduler-generated record exists for today.'}</p></div><Link className="next-action" to={nextClass ? '/review' : '/timetable'}>{nextClass ? 'Review today' : 'View timetable'} <ChevronRight size={15} /></Link></section>
    {settingsOpen && <Overlay title="Settings" onClose={onSettingsClose} footer={<button type="button" className="button button-secondary" onClick={onSettingsClose}>Done</button>}>
      <p className="settings-modal-intro">Manage local data and backups for this device.</p>
      <div className="settings-action-list">
        <button type="button" className="settings-action" disabled={state !== 'ready' || backupBusy} onClick={exportBackup}><span className="settings-action-icon"><ArrowDownToLine size={17} /></span><span><strong>Export backup</strong><small>Save a copy of your local attendance data.</small></span></button>
        <button type="button" className="settings-action" disabled={state !== 'ready' || backupBusy} onClick={importBackup}><span className="settings-action-icon"><Upload size={17} /></span><span><strong>Restore backup</strong><small>Restore data from a saved backup file.</small></span></button>
        <button type="button" className="settings-action" disabled={state !== 'ready' || backupBusy} onClick={() => { setTimetableMessage(''); setTimetableImportOpen(true); }}><span className="settings-action-icon"><CalendarDays size={17} /></span><span><strong>Upload timetable</strong><small>Read a JPG or PNG photo and review weekly classes before importing.</small></span></button>
        <button type="button" className="settings-action settings-action-danger" disabled={state !== 'ready' || backupBusy} onClick={() => { setTimetableMessage(''); setClearTimetableOpen(true); }}><span className="settings-action-icon"><Trash2 size={17} /></span><span><strong>Clear timetable</strong><small>Remove recurring classes and eligible future Pending records.</small></span></button>
        <button type="button" className="settings-action settings-action-danger" disabled={state !== 'ready' || !hasRecords || backupBusy} onClick={() => { setResetError(''); setResetMessage(''); setResetPhrase(''); setResetOpen(true); }}><span className="settings-action-icon"><Trash2 size={17} /></span><span><strong>Reset attendance</strong><small>Remove attendance records and correction history.</small></span></button>
      </div>
      <section className="app-lock-settings" aria-labelledby="app-lock-settings-title">
        <div className="settings-about-heading"><h3 id="app-lock-settings-title">App lock</h3><span>{appLock?.enabled ? 'On' : 'Off'}</span></div>
        <p className="app-lock-settings-copy">Choose fingerprint/face, a custom PIN, or both. You can turn the lock on or off whenever you want.</p>
        {!isNativeAppLockAvailable() && <p className="settings-modal-status">App Lock is available in the installed Android app.</p>}
        {appLock && isNativeAppLockAvailable() && <>
          <div className="app-lock-option app-lock-master"><span><strong>Require unlock</strong><small>Lock when opening the app and after returning from the background.</small></span><button type="button" className={`button button-small app-lock-toggle${appLock.enabled ? ' app-lock-toggle-on' : ''}`} aria-pressed={Boolean(appLock.enabled)} disabled={appLockBusy} onClick={toggleAppLock}>{appLockBusy ? 'Updating…' : appLock.enabled ? 'Turn App Lock Off' : 'Turn App Lock On'}</button></div>
          <label className="app-lock-option"><span><strong>Fingerprint or face</strong><small>{appLock.biometricAvailable ? 'Uses biometric methods enrolled on this device.' : 'Set up fingerprint or face unlock in Android settings first.'}</small></span><input type="checkbox" checked={Boolean(appLock.biometricEnabled)} disabled={appLockBusy || !appLock.biometricAvailable} onChange={(event) => saveLockPreferences({ biometricEnabled: event.target.checked })} /></label>
          <label className="app-lock-option"><span><strong>Custom PIN</strong><small>{appLock.hasPin ? 'A secure PIN is set on this device.' : 'Create a 4 to 8 digit PIN below.'}</small></span><input type="checkbox" checked={Boolean(appLock.pinEnabled)} disabled={appLockBusy || !appLock.hasPin} onChange={(event) => saveLockPreferences({ pinEnabled: event.target.checked })} /></label>
          <details className="app-lock-pin-setup" open={appLockPinSetupOpen} onToggle={(event) => setAppLockPinSetupOpen(event.currentTarget.open)}><summary>{appLock.hasPin ? 'Change custom PIN' : 'Set up custom PIN'}</summary><form className="app-lock-pin-fields" onSubmit={saveCustomPin}><label className="field"><span>New PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" minLength={4} maxLength={8} value={appLockPin} onChange={(event) => setAppLockPinValue(event.target.value.replace(/\D/g, ''))} required /></label><label className="field"><span>Confirm PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" minLength={4} maxLength={8} value={appLockPinConfirm} onChange={(event) => setAppLockPinConfirm(event.target.value.replace(/\D/g, ''))} required /></label><button type="submit" className="button button-secondary button-small" disabled={appLockBusy || appLockPin.length < 4 || appLockPin !== appLockPinConfirm}>{appLockBusy ? 'Saving…' : 'Save PIN'}</button></form></details>
          {appLock.enabled && <button type="button" className="button button-secondary button-small app-lock-now" onClick={() => globalThis.dispatchEvent(new Event('attenda:lock-now'))}><ShieldCheck size={14} />Lock now</button>}
        </>}
        {appLockError && <p className="settings-modal-status settings-modal-error" role="alert">{appLockError}</p>}
      </section>
      <section className="settings-about" aria-labelledby="settings-about-title">
        <div className="settings-about-heading"><h3 id="settings-about-title">About</h3><span>Version 1.0</span></div>
        <details className="settings-about-detail"><summary>Release notes</summary><p>Local attendance storage, semester timetables, after-class Pending records, attendance reminders, manual attendance entry, CSV/XLSX import, and device backups.</p></details>
        <details className="settings-about-detail"><summary>Developer information</summary><p>Developer and release publisher: Archit Naik.</p></details>
        <details className="settings-about-detail"><summary><ShieldCheck size={13} />Privacy policy</summary><p>Attendance data is stored on this device. This app does not connect to a backend. Imported spreadsheets are read on-device. Backups are saved only when you choose a location. Notifications are scheduled locally. Keep a backup before removing the app.</p></details>
        <a className="settings-about-report" href="mailto:?subject=Attendance%20Tracker%20bug%20report&body=App%20version%3A%201.0%0A%0ADescribe%20the%20problem%20and%20steps%20to%20reproduce%3A%0A"><Bug size={14} /><span>Report a bug</span><small>Opens your email app</small></a>
      </section>
      {state !== 'ready' && <p className="settings-modal-status" role="status">{state === 'loading' ? 'Loading local data…' : state === 'signed-out' ? 'Open the installed app and set up local data to use these actions.' : error || 'Local data is unavailable.'}</p>}
      {resetMessage && <p className="settings-modal-status" role="status">{resetMessage}</p>}
      {timetableMessage && <p className="settings-modal-status" role="status">{timetableMessage}</p>}
      {backupError && <p className="settings-modal-status settings-modal-error" role="alert">{backupError}</p>}
      {backupBusy && <p className="settings-modal-status" role="status">Working…</p>}
    </Overlay>}
    {timetableImportOpen && <TimetableImportModal onClose={() => setTimetableImportOpen(false)} onImported={(text) => { setTimetableMessage(text); load(true); }} />}
    {clearTimetableOpen && <ClearTimetableDialog onClose={() => setClearTimetableOpen(false)} onCleared={(text) => { setTimetableMessage(text); load(true); }} />}
    {resetOpen && <Overlay title="Reset all attendance records?" onClose={() => { if (!resetBusy) { setResetOpen(false); setResetPhrase(''); } }} footer={<><button type="button" className="button button-secondary" disabled={resetBusy} onClick={() => { setResetOpen(false); setResetPhrase(''); }}>Cancel</button><button type="button" className="button button-danger" disabled={resetBusy || resetPhrase.trim().toUpperCase() !== 'RESET'} onClick={confirmReset}>{resetBusy ? 'Resetting…' : <><Trash2 size={14} />Delete all records</>}</button></>}><p className="dialog-copy">This permanently removes all <strong>{summary?.total ?? 0}</strong> saved Pending, Present, Absent, and Cancelled attendance records and their correction history on this device.</p><p className="dialog-copy">Your semester, subjects, timetable, holidays, and scheduler setting on this device will be kept. If the scheduler is enabled, it may generate today’s scheduled class records again on its next check.</p><label className="field"><span>Type RESET to confirm <em>*</em></span><input type="text" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} autoComplete="off" autoCapitalize="characters" disabled={resetBusy} /></label>{resetError && <p className="form-error" role="alert">{resetError}</p>}</Overlay>}
  </>;
}
