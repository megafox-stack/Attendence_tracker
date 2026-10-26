import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Activity, Bell, CalendarDays, Check, CircleHelp, Home, ListChecks, Sparkles, X } from 'lucide-react';
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
  return <div className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><NavLink to="/" className="brand"><span className="brand-mark"><CalendarDays size={18} /></span><span><strong>Attendance Tracker</strong><small>ATTENDANCE TRACKER</small></span></NavLink><div className="topbar-right"><span className="connection-pill connection-ready" title={Capacitor.isNativePlatform() ? 'Data is saved on this device' : 'Open the installed Android app to use local storage'}><span className="connection-dot" />{Capacitor.isNativePlatform() ? 'On this device' : 'Android app required'}</span><button type="button" className="icon-button notification-button" aria-label="Notifications are not configured" title="Notifications are not configured"><Bell size={18} /></button></div></header>
    <div className="body-layout"><main className="main-area"><div className="content-width"><Routes><Route path="/" element={<HomePage />} /><Route path="/attendance" element={<AttendancePage />} /><Route path="/timetable" element={<TimetablePage />} /><Route path="/review" element={<DailyReviewPage />} /><Route path="/insights" element={<InsightsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes><footer className="page-footer">Attendance data is stored on this device and is available offline.</footer></div></main></div>
    <nav className="bottom-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `bottom-link${isActive || (to === '/attendance' && location.pathname === '/review') ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
  </div>;
}

export default function App() { return <AppShell />; }
