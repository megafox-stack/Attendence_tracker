import { useMemo, useState } from 'react';
import { CalendarDays, Clock3, Filter, ListChecks, Search, Settings2, SlidersHorizontal, Sparkles, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, Notice, PageHeading } from '../App.jsx';
const tabs = ['Subjects', 'Attendance history'];

export default function AttendancePage() {
  const [tab, setTab] = useState(tabs[0]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const summary = useMemo(() => ({ percent: '—', present: '—', finalized: '—' }), []);

  return <><PageHeading eyebrow="YOUR RECORDS" title="My Attendance" description="Your subject-wise attendance, in one place." />
    <section className="card attendance-summary"><div className="summary-left"><div className="summary-progress"><span>—</span></div><div><span className="card-kicker">OVERALL ATTENDANCE</span><h2>No attendance data</h2><p>Present / (Present + Absent)</p></div></div><div className="summary-stats"><div><strong>{summary.present}</strong><span>Present</span></div><div><strong>{summary.finalized}</strong><span>Classes attended</span></div></div></section>
    <section className="tab-card"><div className="tab-list" role="tablist" aria-label="Attendance views">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`tab-button${tab === item ? ' active' : ''}`} onClick={() => setTab(item)}>{item === 'Subjects' ? <UsersRound size={15} /> : <Clock3 size={15} />}{item}</button>)}</div>
      {tab === 'Subjects' ? <div className="tab-content"><div className="section-toolbar"><div><h2>Subject breakdown</h2><p>See your present, absent, pending, and cancelled classes for each subject.</p></div><span className="counter-pill"><UsersRound size={14} />No subjects</span></div><div className="subject-empty"><EmptyState icon={UsersRound} title="No subjects yet" description="Subjects and attendance summaries will appear once you connect your account and set up your timetable." action={<Link className="button button-primary button-small" to="/timetable"><Settings2 size={14} />Set up timetable</Link>} /></div><Notice>Subject records will load from the attendance service when it is connected.</Notice></div> : <div className="tab-content"><div className="section-toolbar history-toolbar"><div><h2>Attendance history</h2><p>Browse class records by date, subject, and attendance status.</p></div><button type="button" className={`button button-secondary button-small${filtersOpen ? ' selected' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={14} />{filtersOpen ? 'Hide filters' : 'Filters'}</button></div>
      <div className={`history-filters${filtersOpen ? ' filters-open' : ''}`}><label className="search-field"><Search size={15} /><input aria-label="Filter by subject" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by subject" /></label><label className="filter-select"><Filter size={14} /><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option>All statuses</option><option>Pending</option><option>Present</option><option>Absent</option><option>Cancelled</option></select></label><label className="filter-date"><span>From</span><input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="filter-date"><span>To</span><input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} min={from || undefined} /></label><button type="button" className="button button-quiet button-small" onClick={() => { setQuery(''); setStatus('All statuses'); setFrom(''); setTo(''); }}>Clear</button></div>
      <div className="history-empty"><EmptyState icon={CalendarDays} title="No attendance records" description="Your attendance history will appear here once records have been added to your account." /><div className="filter-note">{query || status !== 'All statuses' || from || to ? 'Filters are ready and will apply to connected records.' : 'No records are available to filter yet.'}</div></div></div>}
    </section>
  </>;
}
