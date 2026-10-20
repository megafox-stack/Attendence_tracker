import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Home, ListChecks, Menu, Plus, Settings2, Sparkles, X } from 'lucide-react';
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
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const titles = { '/': 'Good morning', '/attendance': 'My attendance', '/timetable': 'Timetable & Scheduler', '/review': 'Daily review', '/insights': 'Insights' };
  const title = titles[location.pathname] || 'Attendance Tracker';

  return <div className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><NavLink to="/" className="brand"><span className="brand-mark"><CalendarDays size={18} /></span><span><strong>Attenda</strong><small>ATTENDANCE TRACKER</small></span></NavLink><div className="topbar-right"><span className="connection-pill"><span className="connection-dot" /> Not connected</span><button type="button" className="icon-button notification-button" aria-label="Notifications are not available until the backend is connected"><Bell size={18} /></button><div className="avatar" aria-label="No profile connected">—</div></div></header>
    <div className="body-layout"><main className="main-area"><div className="content-width"><Routes><Route path="/" element={<HomePage />} /><Route path="/attendance" element={<AttendancePage />} /><Route path="/timetable" element={<TimetablePage />} /><Route path="/review" element={<DailyReviewPage />} /><Route path="/insights" element={<InsightsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes><footer className="page-footer">Attendance data will appear here once your account is connected.</footer></div></main></div>
    <nav className="bottom-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `bottom-link${isActive || (to === '/attendance' && location.pathname === '/review') ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
  </div>;
}

export default function App() { return <AppShell />; }
