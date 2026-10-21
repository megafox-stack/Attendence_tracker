import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, ChevronRight, CircleHelp, Clock3, Gauge, ListChecks, Settings2, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, PageHeading, SectionTitle } from '../App.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { hasSessionToken } from '../services/apiClient.js';
import { getDashboardStatistics } from '../services/attendanceService.js';
import { getSchedulerStatus } from '../services/schedulerService.js';

function Metric({ icon: Icon, label, value, accent = '' }) {
  return <div className="overview-metric"><span className={`metric-icon ${accent}`}><Icon size={16} /></span><span className="metric-text"><small>{label}</small><strong>{value}</strong></span></div>;
}

export default function HomePage() {
  const [dashboard, setDashboard] = useState(null);
  const [scheduler, setScheduler] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!hasSessionToken()) { setDashboard(null); setScheduler(null); setState('signed-out'); return; }
    if (!quiet) setState('loading');
    try {
      const [summary, schedulerResult] = await Promise.all([getDashboardStatistics(), getSchedulerStatus()]);
      setDashboard(summary); setScheduler(schedulerResult.scheduler); setError(''); setState('ready');
    } catch (requestError) { setState('error'); setError(requestError.message || 'Could not load account attendance.'); }
  }, []);
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

  return <><PageHeading eyebrow="YOUR OVERVIEW" title="Welcome" description="Stay consistent. Your attendance builds your future." />
    {state === 'error' && <div className="inline-feedback" role="alert">{error}<button type="button" onClick={load}>Retry</button></div>}
    <section className="card overview-card"><div className="overview-top"><div className="overview-copy"><span className="card-kicker">OVERALL ATTENDANCE</span><div className="percentage-line"><strong>{percentage == null ? '—' : `${percentage}%`}</strong><span>{percentage == null ? (state === 'loading' ? 'Loading records' : 'No attendance data') : 'Present / finalized'}</span></div><p>{hasRecords ? `${summary.finalized} finalized classes. Pending and cancelled records are excluded from the percentage.` : 'Your summary will appear when the scheduler creates records and you confirm attendance.'}</p></div><div className={`progress-ring${percentage == null ? ' ring-empty' : ''}`} style={percentage == null ? undefined : { background: `conic-gradient(#2678fc ${percentage * 3.6}deg,#eaf2fb ${percentage * 3.6}deg 360deg)` }} role="img" aria-label={percentage == null ? 'No attendance data' : `${percentage}% attendance`}><div><Gauge size={21} /><span>{percentage == null ? '—' : `${percentage}%`}</span></div></div></div>
      <div className="overview-divider" /><div className="metrics-grid"><Metric icon={TrendingUp} label="Present" value={hasRecords ? summary.Present : '—'} accent="metric-green" /><Metric icon={CircleHelp} label="Absent" value={hasRecords ? summary.Absent : '—'} accent="metric-red" /><Metric icon={Clock3} label="Pending" value={hasRecords ? summary.Pending : '—'} accent="metric-amber" /><Metric icon={CalendarDays} label="Cancelled" value={hasRecords ? summary.Cancelled : '—'} accent="metric-slate" /></div></section>
    <div className="home-columns"><div className="stack-column"><section className="card scheduler-home"><div className="scheduler-symbol"><CalendarDays size={19} /></div><div className="scheduler-copy"><div className="card-title-line"><h2>Automatic scheduler</h2><span className="state-pill state-neutral"><span />{schedulerLabel}</span></div><p>{scheduler?.enabled ? 'The backend creates Pending records from your timetable once per local day.' : 'Enable it in Timetable & Scheduler after setting up your semester and weekly classes.'}</p></div><Link className="arrow-link" to="/timetable" aria-label="Open timetable setup"><ChevronRight size={18} /></Link></section>
      <section className="card review-banner"><span className="review-icon"><ListChecks size={19} /></span><div className="review-copy"><strong>End of day review</strong><p>{todaysRecords.filter((record) => record.status === 'Pending').length ? `${todaysRecords.filter((record) => record.status === 'Pending').length} classes awaiting review today.` : 'Review or correct today’s attendance in one place.'}</p></div><Link to="/review" className="text-link">Review <ArrowRight size={14} /></Link></section>
      {hasRecords && <section className="card alert-card"><div className="alert-icon"><Bell size={17} /></div><div><h2>Attendance overview</h2><p>{summary.Pending ? `${summary.Pending} classes are waiting for confirmation.` : 'There are no pending attendance records.'}</p></div><Link className="alert-label" to="/attendance">View records</Link></section>}</div>
      <section className="card today-card"><SectionTitle title="Today's classes" action={<Link to="/review" className="subtle-link">Review <ArrowRight size={14} /></Link>} />
        {state === 'loading' && <EmptyState icon={Clock3} title="Loading today’s records" description="Checking the backend for scheduler-generated classes." />}
        {state === 'signed-out' && <EmptyState icon={CalendarDays} title="Sign in to see classes" description="Today’s schedule and attendance records are loaded from your account." />}
        {state === 'ready' && !todaysRecords.length && <EmptyState icon={CalendarDays} title="No classes to show" description={scheduler?.enabled ? 'No occurrences exist for today. Check your working days, timetable, and scheduler status.' : 'Enable the scheduler after configuring your timetable to create daily class records.'} action={<Link className="button button-secondary button-small" to="/timetable"><Settings2 size={14} />Timetable setup</Link>} />}
        {state === 'ready' && todaysRecords.length > 0 && <div className="home-class-list">{todaysRecords.map((record) => <Link className="home-class-row" to="/review" key={record.id}><span className="home-class-icon"><CalendarDays size={15} /></span><span className="home-class-copy"><strong>{record.subject}</strong><small>{record.code} · {record.start}–{record.end}{record.room ? ` · ${record.room}` : ''}</small></span><StatusBadge status={record.status} /><ChevronRight size={14} /></Link>)}</div>}
      </section></div>
    <section className="card next-card"><div className="next-icon"><Clock3 size={18} /></div><div className="next-copy"><span className="card-kicker">UP NEXT</span><h2>{nextClass ? nextClass.subject : 'No upcoming class record'}</h2><p>{nextClass ? `${nextClass.start}–${nextClass.end} · ${nextClass.code}${nextClass.room ? ` · ${nextClass.room}` : ''}` : 'Next class appears here after a scheduler-generated record exists for today.'}</p></div><Link className="next-action" to={nextClass ? '/review' : '/timetable'}>{nextClass ? 'Review today' : 'View timetable'} <ChevronRight size={15} /></Link></section>
  </>;
}
