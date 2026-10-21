import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, BadgeCheck, Bell, CalendarDays, Check, CircleHelp, Home, ListChecks, LogIn, LogOut, Sparkles, X } from 'lucide-react';
import { ApiError, ApiUnavailableError } from './services/apiClient.js';
import { checkApiHealth, loginAccount, logoutAccount, registerAccount } from './services/authService.js';
import HomePage from './pages/HomePage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import TimetablePage from './pages/TimetablePage.jsx';
import DailyReviewPage from './pages/DailyReviewPage.jsx';
import InsightsPage from './pages/InsightsPage.jsx';

export const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/attendance', label: 'Attendance', icon: ListChecks },
  { to: '/timetable', label: 'Timetable', icon: CalendarDays },
  { to: '/insights', label: 'Insights', icon: Activity },
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

export function Field({ label, value, onChange, type = 'text', required = false, placeholder, name, min, max }) {
  return <label className="field"><span>{label}{required && <em> *</em>}</span><input type={type} name={name} value={value ?? ''} onChange={onChange} required={required} placeholder={placeholder} min={min} max={max} /></label>;
}

export function SelectField({ label, value, onChange, children, required = false, name }) {
  return <label className="field"><span>{label}{required && <em> *</em>}</span><select name={name} value={value} onChange={onChange} required={required}>{children}</select></label>;
}

export function Overlay({ title, onClose, children, footer, wide = false }) {
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`dialog${wide ? ' dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><div className="dialog-content">{children}</div>{footer && <footer className="dialog-footer">{footer}</footer>}</section></div>;
}

function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [apiState, setApiState] = useState('checking');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [globalNotice, setGlobalNotice] = useState('');

  useEffect(() => {
    let active = true;
    checkApiHealth()
      .then(() => { if (active) setApiState('ready'); })
      .catch(() => { if (active) setApiState('offline'); });
    return () => { active = false; };
  }, []);

  async function handleLogout() {
    setLogoutBusy(true);
    try {
      await logoutAccount();
      setGlobalNotice('Signed out. Your attendance data remains on the server.');
    } catch {
      setGlobalNotice('Signed out on this device. The server could not be reached to revoke the session.');
    } finally {
      setUser(null);
      setLogoutBusy(false);
      setAuthOpen(true);
    }
  }

  const titles = { '/': 'Good morning', '/attendance': 'My attendance', '/timetable': 'Timetable & Scheduler', '/review': 'Daily review', '/insights': 'Insights' };

  return <div className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><NavLink to="/" className="brand"><span className="brand-mark"><CalendarDays size={18} /></span><span><strong>Attendance Tracker</strong><small>ATTENDANCE TRACKER</small></span></NavLink><div className="topbar-right"><span className={`connection-pill connection-${apiState}`}><span className="connection-dot" />{apiState === 'ready' ? 'API connected' : apiState === 'checking' ? 'Checking API' : 'API not connected'}</span><button type="button" className="icon-button notification-button" aria-label="Notifications will be available after attendance services are connected" title="Notifications unavailable"><Bell size={18} /></button>{user ? <><span className="account-name">{user.displayName || user.email}</span><span className="account-connected" role="status" aria-label="Account connected" title="Account connected"><BadgeCheck size={14} /><span className="account-connected-full">Account connected</span><span className="account-connected-compact">Connected</span></span><button type="button" className="account-action account-signout" aria-label="Sign out" title="Sign out" onClick={handleLogout} disabled={logoutBusy}><LogOut size={14} /><span>Sign out</span></button></> : <button type="button" className="account-action" onClick={() => { setGlobalNotice(''); setAuthOpen(true); }}><LogIn size={14} /><span>Sign in</span></button>}</div></header>
    <div className="body-layout"><main className="main-area"><div className="content-width">{globalNotice && <div className="auth-global-notice" role="status">{globalNotice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setGlobalNotice('')}><X size={15} /></button></div>}<Routes><Route path="/" element={<HomePage />} /><Route path="/attendance" element={<AttendancePage />} /><Route path="/timetable" element={<TimetablePage />} /><Route path="/review" element={<DailyReviewPage />} /><Route path="/insights" element={<InsightsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes><footer className="page-footer">{user ? `Signed in as ${user.email}. Daily review uses class records from your account.` : 'Attendance data will appear here once you connect your account.'}</footer></div></main></div>
    <nav className="bottom-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `bottom-link${isActive || (to === '/attendance' && location.pathname === '/review') ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
  {authOpen && <AuthDialog apiState={apiState} onClose={() => setAuthOpen(false)} onAuthenticated={(nextUser) => { setUser(nextUser); setApiState('ready'); setAuthOpen(false); setGlobalNotice('Account connected. Timetable and daily attendance records are available from the backend. Scheduler generation is not connected.'); }} />}
  </div>;
}

function AuthDialog({ apiState, onClose, onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const currentUser = mode === 'register'
        ? await registerAccount({ email, password, displayName, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
        : await loginAccount({ email, password });
      onAuthenticated(currentUser);
    } catch (requestError) {
      if (requestError instanceof ApiUnavailableError) setError('Cannot reach the backend. Start the API and check VITE_API_URL.');
      else if (requestError instanceof ApiError) setError(requestError.message);
      else setError('Could not connect your account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <Overlay title={mode === 'login' ? 'Sign in to Attendance Tracker' : 'Create your account'} onClose={onClose}>
    <div className="auth-dialog-intro">{apiState === 'ready' ? 'Connect an account to begin using attendance services.' : 'The backend must be running and configured before account access is available.'}</div>
    {apiState !== 'ready' && <div className="auth-config-note" role="status">API status: not connected. Configure <code>VITE_API_URL</code> and start the backend.</div>}
    <form className="form-stack auth-form" onSubmit={submit}>
      {mode === 'register' && <label className="field"><span>Display name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} autoComplete="name" placeholder="Optional" /></label>}
      <label className="field"><span>Email address <em>*</em></span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" /></label>
      <label className="field"><span>Password <em>*</em></span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 12 : undefined} maxLength={1024} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />{mode === 'register' && <small className="field-hint">Use at least 12 characters.</small>}</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary auth-submit" disabled={busy}>{busy ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
    </form>
    <p className="auth-switch">{mode === 'login' ? 'New here?' : 'Already have an account?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}> {mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
    <p className="auth-footnote">Your session is held in memory on this device and will need a new sign in after the app restarts. Account data is stored by the backend.</p>
  </Overlay>;
}

export default function App() { return <AppShell />; }
