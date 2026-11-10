import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Bell, CalendarDays, Check, CircleHelp, Fingerprint, Home, KeyRound, ListChecks, ClipboardCheck, LockKeyhole, Settings, Sparkles, X } from 'lucide-react';
import HomePage from './pages/HomePage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import TimetablePage from './pages/TimetablePage.jsx';
import DailyReviewPage from './pages/DailyReviewPage.jsx';
import ManualAttendancePage from './pages/ManualAttendancePage.jsx';
import NotificationSettingsModal from './components/NotificationSettingsModal.jsx';
import { authenticateAppLock, getAppLockState, isNativeAppLockAvailable, verifyAppLockPin } from './services/appLockService.js';

export const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/attendance', label: 'Attendance', icon: ListChecks },
  { to: '/timetable', label: 'Timetable', icon: CalendarDays },
  { to: '/insights', label: 'Manual Attendance', icon: ClipboardCheck },
];

export function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}
export function SectionTitle({ title, description, action }) {
  return <div className="section-title"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function EmptyState({ icon: Icon = CircleHelp, title = 'Nothing here yet', description, action }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Notice({ children, tone = 'info' }) {
  return <div className={`notice notice-${tone}`} role="status"><span className="notice-icon">{tone === 'success' ? <Check size={17} /> : tone === 'warning' ? <CircleHelp size={17} /> : <Sparkles size={17} />}</span><span>{children}</span></div>;
}
export function Field({ label, value, onChange, type = 'text', required = false, placeholder, name, min, max, maxLength, disabled = false }) {
  return <label className="field"><span>{label}{required && <em> *</em>}</span><input type={type} name={name} value={value ?? ''} onChange={onChange} required={required} placeholder={placeholder} min={min} max={max} maxLength={maxLength} disabled={disabled} /></label>;
}
export function SelectField({ label, value, onChange, children, required = false, name, disabled = false }) {
  return <label className="field"><span>{label}{required && <em> *</em>}</span><select name={name} value={value} onChange={onChange} required={required} disabled={disabled}>{children}</select></label>;
}
export function Overlay({ title, onClose, children, footer, wide = false }) {
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`dialog${wide ? ' dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><div className="dialog-content">{children}</div>{footer && <footer className="dialog-footer">{footer}</footer>}</section></div>;
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appLock, setAppLock] = useState({ checking: isNativeAppLockAvailable(), locked: false, enabled: false, biometricEnabled: false, pinEnabled: false });
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  useEffect(() => {
    if (!isNativeAppLockAvailable()) return;
    let active = true;
    let fileChooserActive = false;
    let skipFileChooserResumeLock = false;
    const refreshLock = async (lockIfEnabled = false) => {
      try {
        const state = await getAppLockState();
        if (active) setAppLock((current) => ({ ...state, checking: false, locked: Boolean(state.enabled && (lockIfEnabled || current.locked)) }));
      } catch { if (active) setAppLock((value) => ({ ...value, checking: false })); }
    };
    refreshLock(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (fileChooserActive) { skipFileChooserResumeLock = true; return; }
        setAppLock((value) => ({ ...value, locked: value.enabled }));
      } else if (document.visibilityState === 'visible') {
        if (skipFileChooserResumeLock) { skipFileChooserResumeLock = false; fileChooserActive = false; return; }
        refreshLock(false);
      }
    };
    const onFileChooserOpen = () => { fileChooserActive = true; };
    const onFileChooserClose = () => { fileChooserActive = false; };
    const onSettingsChanged = () => refreshLock(false);
    const onLockNow = () => setAppLock((value) => value.enabled ? { ...value, locked: true } : value);
    document.addEventListener('visibilitychange', onVisibility);
    globalThis.addEventListener('attenda:file-chooser-open', onFileChooserOpen);
    globalThis.addEventListener('attenda:file-chooser-close', onFileChooserClose);
    globalThis.addEventListener('attenda:app-lock-changed', onSettingsChanged);
    globalThis.addEventListener('attenda:lock-now', onLockNow);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisibility); globalThis.removeEventListener('attenda:file-chooser-open', onFileChooserOpen); globalThis.removeEventListener('attenda:file-chooser-close', onFileChooserClose); globalThis.removeEventListener('attenda:app-lock-changed', onSettingsChanged); globalThis.removeEventListener('attenda:lock-now', onLockNow); };
  }, []);
  useEffect(() => {
    const openNotificationRoute = (event) => {
      const path = event.detail?.path;
      if (typeof path === 'string' && (path === '/timetable' || path === '/attendance' || path.startsWith('/review'))) navigate(path);
    };
    globalThis.addEventListener('attenda:notification-open', openNotificationRoute);
    return () => globalThis.removeEventListener('attenda:notification-open', openNotificationRoute);
  }, [navigate]);
  async function unlockWithPin(event) {
    event.preventDefault(); setUnlockBusy(true); setUnlockError('');
    try { await verifyAppLockPin(unlockPin); setUnlockPin(''); setAppLock((value) => ({ ...value, locked: false })); }
    catch (error) { setUnlockError(error.message || 'Could not verify the PIN.'); }
    finally { setUnlockBusy(false); }
  }
  async function unlockWithBiometric() {
    setUnlockBusy(true); setUnlockError('');
    try { await authenticateAppLock(); setAppLock((value) => ({ ...value, locked: false })); }
    catch (error) { setUnlockError(error.message || 'Biometric unlock was not completed.'); }
    finally { setUnlockBusy(false); }
  }
  if (appLock.checking || appLock.locked) return <main className="app-lock-screen"><section className="app-lock-card" aria-label="App unlock"><span className="app-lock-mark"><LockKeyhole size={22} /></span><h1>Attendance Tracker</h1><p>{appLock.checking ? 'Checking app security…' : 'Unlock to continue'}</p>{appLock.locked && <>
    {appLock.biometricEnabled && <button type="button" className="button button-primary app-lock-biometrics" disabled={unlockBusy} onClick={unlockWithBiometric}><Fingerprint size={17} />Unlock with fingerprint or face</button>}
    {appLock.pinEnabled && <form className="app-lock-pin-form" onSubmit={unlockWithPin}><label className="field"><span>App PIN</span><input type="password" inputMode="numeric" autoComplete="current-password" maxLength={8} value={unlockPin} onChange={(event) => setUnlockPin(event.target.value.replace(/\D/g, ''))} autoFocus /></label><button type="submit" className="button button-primary" disabled={unlockBusy || unlockPin.length < 4}><KeyRound size={15} />{unlockBusy ? 'Unlocking…' : 'Unlock with PIN'}</button></form>}
    {unlockError && <p className="app-lock-error" role="alert">{unlockError}</p>}
  </>}</section></main>;
  return <div className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><NavLink to="/" className="brand"><span className="brand-mark"><CalendarDays size={18} /></span><span><strong>Attendance Tracker</strong><small>Track your attendance anytime</small></span></NavLink><div className="topbar-right"><button type="button" className="icon-button notification-button" aria-label="Notification settings" title="Notification settings" onClick={() => setNotificationSettingsOpen(true)}><Bell size={18} /></button><button type="button" className="icon-button app-settings-button" aria-label="App settings" title="App settings" onClick={() => { setAppSettingsOpen(true); if (location.pathname !== '/') navigate('/'); }}><Settings size={18} /></button></div></header>
    <div className="body-layout"><main className="main-area"><div className="content-width"><Routes><Route path="/" element={<HomePage settingsOpen={appSettingsOpen} onSettingsClose={() => setAppSettingsOpen(false)} />} /><Route path="/attendance" element={<AttendancePage />} /><Route path="/timetable" element={<TimetablePage />} /><Route path="/review" element={<DailyReviewPage />} /><Route path="/insights" element={<ManualAttendancePage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes><footer className="page-footer">Attendance data is stored on this device and is available offline.</footer></div></main></div>
    <nav className="bottom-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `bottom-link${isActive || (to === '/attendance' && location.pathname === '/review') ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
    {notificationSettingsOpen && <NotificationSettingsModal onClose={() => setNotificationSettingsOpen(false)} />}
  </div>;
}

export default function App() { return <AppShell />; }
