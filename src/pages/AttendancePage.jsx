import { useEffect, useState } from 'react';
import { CalendarDays, Clock3, Filter, Search, Settings2, SlidersHorizontal, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, Notice, PageHeading } from '../App.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { hasSessionToken } from '../services/apiClient.js';
import { getAttendanceHistory, getAttendanceSubjects, getDashboardStatistics } from '../services/attendanceService.js';

const tabs = ['Subjects', 'Attendance history'];

export default function AttendancePage() {
  const [tab, setTab] = useState(tabs[0]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [records, setRecords] = useState([]);
  const [state, setState] = useState(hasSessionToken() ? 'loading' : 'signed-out');
  const [historyState, setHistoryState] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadSummary(quiet = false) {
      if (!hasSessionToken()) { setSummary(null); setSubjects([]); setRecords([]); setState('signed-out'); return; }
      if (!quiet) setState('loading');
      try {
        const [dashboard, subjectsResult] = await Promise.all([getDashboardStatistics(), getAttendanceSubjects()]);
        if (!active) return;
        setSummary(dashboard.summary); setSubjects(subjectsResult.subjects || []); setState('ready'); setError('');
      } catch (requestError) { if (active) { setState('error'); setError(requestError.message || 'Could not load attendance records.'); } }
    }
    loadSummary();
    const refresh = () => loadSummary(true);
    globalThis.addEventListener('attenda:session-change', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(timer); globalThis.removeEventListener('attenda:session-change', refresh); };
  }, []);

  useEffect(() => {
    if (tab !== 'Attendance history' || !hasSessionToken()) return undefined;
    let active = true;
    const fetchRecords = async (quiet = false) => {
      if (!quiet) setHistoryState('loading');
      const params = new URLSearchParams();
      if (query.trim()) params.set('subject', query.trim());
      if (status !== 'All statuses') params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      try {
        const result = await getAttendanceHistory(params.size ? `?${params}` : '');
        if (active) { setRecords(result.records || []); setHistoryState('ready'); }
      } catch (requestError) { if (active) { setHistoryState('error'); setError(requestError.message || 'Could not load attendance history.'); } }
    };
    const debounce = setTimeout(() => fetchRecords(), 180);
    const refresh = setInterval(() => fetchRecords(true), 60_000);
    return () => { active = false; clearTimeout(debounce); clearInterval(refresh); };
  }, [tab, query, status, from, to, state]);

  const hasRecords = Boolean(summary?.total);
  return <><PageHeading eyebrow="YOUR RECORDS" title="My Attendance" description="Your subject-wise attendance, in one place." />
    {state === 'error' && <div className="inline-feedback" role="alert">{error}<button type="button" onClick={() => globalThis.dispatchEvent(new Event('attenda:session-change'))}>Retry</button></div>}
    <section className="card attendance-summary"><div className="summary-left"><div className="summary-progress"><span>{summary?.attendancePercent == null ? '—' : `${summary.attendancePercent}%`}</span></div><div><span className="card-kicker">OVERALL ATTENDANCE</span><h2>{summary?.attendancePercent == null ? 'No attendance data' : `${summary.attendancePercent}% attendance`}</h2><p>Present / (Present + Absent)</p></div></div><div className="summary-stats"><div><strong>{hasRecords ? summary.Present : '—'}</strong><span>Present</span></div><div><strong>{hasRecords ? summary.finalized : '—'}</strong><span>Finalized classes</span></div></div></section>
    <section className="tab-card"><div className="tab-list" role="tablist" aria-label="Attendance views">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`tab-button${tab === item ? ' active' : ''}`} onClick={() => setTab(item)}>{item === 'Subjects' ? <UsersRound size={15} /> : <Clock3 size={15} />}{item}</button>)}</div>
      {tab === 'Subjects' ? <div className="tab-content"><div className="section-toolbar"><div><h2>Subject breakdown</h2><p>See your present, absent, pending, and cancelled classes for each subject.</p></div><span className="counter-pill"><UsersRound size={14} />{subjects.length} subject{subjects.length === 1 ? '' : 's'}</span></div>
        {state === 'loading' && <div className="history-empty">Loading your account records…</div>}
        {state === 'signed-out' && <div className="subject-empty"><EmptyState icon={UsersRound} title="Sign in to view attendance" description="Subject records and attendance summaries are loaded from your account." /></div>}
        {state === 'ready' && !subjects.length && <div className="subject-empty"><EmptyState icon={UsersRound} title="No subjects yet" description="Subjects will appear after you configure a semester and add them to your timetable." action={<Link className="button button-primary button-small" to="/timetable"><Settings2 size={14} />Set up timetable</Link>} /></div>}
        {state === 'ready' && subjects.length > 0 && <div className="attendance-subject-list">{subjects.map((subject) => <article className="card attendance-subject-card" key={subject.id}><div className="attendance-subject-heading"><div><strong>{subject.name}</strong><span>{subject.code}</span></div><b>{subject.attendancePercent == null ? 'No finalized data' : `${subject.attendancePercent}%`}</b></div><div className="attendance-progress"><span style={{ width: `${subject.attendancePercent ?? 0}%` }} /></div><div className="attendance-subject-counts"><span><b>{subject.present}</b> Present</span><span><b>{subject.absent}</b> Absent</span><span><b>{subject.pending}</b> Pending</span><span><b>{subject.cancelled}</b> Cancelled</span></div>{subject.targetPercent != null && <div className={`target-note${subject.attendancePercent != null && subject.attendancePercent < subject.targetPercent ? ' below-target' : ''}`}>Target: {subject.targetPercent}%{subject.attendancePercent != null && subject.attendancePercent < subject.targetPercent ? ' · Below target' : ''}</div>}</article>)}</div>}
        <Notice>Pending and cancelled classes do not count toward the attendance percentage.</Notice></div> : <div className="tab-content"><div className="section-toolbar history-toolbar"><div><h2>Attendance history</h2><p>Browse class records by date, subject, and attendance status.</p></div><button type="button" className={`button button-secondary button-small${filtersOpen ? ' selected' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={14} />{filtersOpen ? 'Hide filters' : 'Filters'}</button></div>
      <div className={`history-filters${filtersOpen ? ' filters-open' : ''}`}><label className="search-field"><Search size={15} /><input aria-label="Filter by subject" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by subject" /></label><label className="filter-select"><Filter size={14} /><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option>All statuses</option><option>Pending</option><option>Present</option><option>Absent</option><option>Cancelled</option></select></label><label className="filter-date"><span>From</span><input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="filter-date"><span>To</span><input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} min={from || undefined} /></label><button type="button" className="button button-quiet button-small" onClick={() => { setQuery(''); setStatus('All statuses'); setFrom(''); setTo(''); }}>Clear</button></div>
      {state === 'signed-out' ? <div className="history-empty"><EmptyState icon={CalendarDays} title="Sign in to view history" description="Your scheduler-generated and confirmed class records will appear here." /></div> : historyState === 'loading' ? <div className="history-empty">Loading attendance history…</div> : historyState === 'error' ? <div className="history-empty" role="alert">{error}</div> : records.length === 0 ? <div className="history-empty"><EmptyState icon={CalendarDays} title="No attendance records" description="Records will appear here after the scheduler creates class occurrences." /><div className="filter-note">Filters apply to records saved in your account.</div></div> : <div className="history-record-list">{records.map((record) => <article className="history-record" key={record.id}><span className="history-record-icon"><CalendarDays size={15} /></span><div className="history-record-info"><strong>{record.subject}</strong><span>{record.code} · {record.date} · {record.start}–{record.end}{record.room ? ` · ${record.room}` : ''}</span></div><StatusBadge status={record.status} /></article>)}</div>}</div>}
    </section>
  </>;
}
