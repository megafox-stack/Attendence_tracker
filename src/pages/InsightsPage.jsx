import { useEffect, useState } from 'react';
import { BarChart3, CalendarRange, ChartNoAxesCombined, ListChecks, Target, TrendingUp } from 'lucide-react';
import { EmptyState, PageHeading } from '../App.jsx';
import { hasSessionToken } from '../services/apiClient.js';
import { getAttendanceInsights } from '../services/attendanceService.js';

function rangeQuery(range) {
  if (range === 'All time') return '';
  if (range === 'Semester') return '?range=semester';
  const days = range === 'Last 90 days' ? 90 : 30;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  const format = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return `?from=${format(from)}&to=${format(to)}`;
}

export default function InsightsPage() {
  const [range, setRange] = useState('Semester');
  const [data, setData] = useState(null);
  const [state, setState] = useState(hasSessionToken() ? 'loading' : 'signed-out');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      if (!hasSessionToken()) { setData(null); setState('signed-out'); return; }
      setState('loading');
      try {
        const result = await getAttendanceInsights(rangeQuery(range));
        if (active) { setData(result); setState('ready'); setError(''); }
      } catch (requestError) { if (active) { setState('error'); setError(requestError.message || 'Could not load attendance insights.'); } }
    }
    load();
    globalThis.addEventListener('attenda:session-change', load);
    return () => { active = false; globalThis.removeEventListener('attenda:session-change', load); };
  }, [range]);

  const summary = data?.summary;
  const subjects = data?.subjects || [];
  const belowTarget = subjects.filter((subject) => subject.targetPercent != null && subject.attendancePercent != null && subject.attendancePercent < subject.targetPercent);
  const trend = (data?.trend || []).filter((item) => item.present + item.absent > 0);
  const hasRecords = Boolean(summary && (summary.Present + summary.Absent + summary.Pending + summary.Cancelled > 0));
  const maxTrend = Math.max(1, ...trend.map((item) => item.present + item.absent));

  return <><PageHeading eyebrow="YOUR PROGRESS" title="Insights" description="Explore attendance trends and see which subjects may need attention." action={<label className="range-picker"><CalendarRange size={15} /><span>Date range</span><select aria-label="Insights date range" value={range} onChange={(event) => setRange(event.target.value)}><option>Last 30 days</option><option>Last 90 days</option><option>Semester</option><option>All time</option></select></label>} />
    {state === 'error' && <div className="inline-feedback" role="alert">{error}</div>}
    <section className="insights-summary-grid"><article className="card insight-stat"><span className="insight-stat-icon stat-blue"><TrendingUp size={17} /></span><span className="card-kicker">OVERALL ATTENDANCE</span><strong>{summary?.attendancePercent == null ? '—' : `${summary.attendancePercent}%`}</strong><p>{summary?.attendancePercent == null ? 'No finalized data' : 'Present / (Present + Absent)'}</p></article><article className="card insight-stat"><span className="insight-stat-icon stat-green"><BarChart3 size={17} /></span><span className="card-kicker">PRESENT CLASSES</span><strong>{hasRecords ? summary.Present : '—'}</strong><p>{hasRecords ? `${summary.Absent} absent` : 'Awaiting attendance data'}</p></article><article className="card insight-stat"><span className="insight-stat-icon stat-red"><Target size={17} /></span><span className="card-kicker">BELOW YOUR TARGET</span><strong>{hasRecords ? belowTarget.length : '—'}</strong><p>{hasRecords ? 'Subjects below configured target' : 'Needs attendance data'}</p></article><article className="card insight-stat"><span className="insight-stat-icon stat-amber"><ListChecks size={17} /></span><span className="card-kicker">TO REVIEW</span><strong>{hasRecords ? summary.Pending : '—'}</strong><p>{hasRecords ? 'Pending class records' : 'Awaiting scheduler records'}</p></article></section>
    {state === 'signed-out' && <section className="card chart-card"><EmptyState icon={ChartNoAxesCombined} title="No local attendance data yet" description="Insights are calculated from class records saved on this device." /></section>}
    {state === 'loading' && <section className="card chart-card"><div className="chart-empty">Loading attendance records from this device…</div></section>}
    {state === 'ready' && !hasRecords && <section className="card chart-card"><EmptyState icon={ChartNoAxesCombined} title="No attendance data yet" description="Insights appear after class records are generated and reviewed on this device." /></section>}
    {state === 'ready' && hasRecords && <><div className="insight-charts"><section className="card chart-card"><div className="chart-heading"><div><span className="card-kicker">ATTENDANCE OVER TIME</span><h2>Attendance trend</h2><p>Present and absent records by class date.</p></div><span className="chart-type"><TrendingUp size={14} />Trend</span></div>{trend.length ? <div className="trend-bars" aria-label="Attendance trend chart">{trend.map((item) => { const total = item.present + item.absent; const value = total ? Math.round((item.present / total) * 100) : 0; return <div className="trend-column" key={item.date} title={`${item.date}: ${value}% (${item.present} present, ${item.absent} absent)`}><div className="trend-bar-track"><span className="trend-bar-present" style={{ height: `${(item.present / maxTrend) * 100}%` }} /><span className="trend-bar-absent" style={{ height: `${(item.absent / maxTrend) * 100}%` }} /></div><small>{item.date.slice(5)}</small><b>{value}%</b></div>; })}</div> : <div className="chart-empty"><h3>No finalized classes in this range</h3><p>Present and absent records will appear after classes are reviewed.</p></div>}</section>
        <section className="card chart-card"><div className="chart-heading"><div><span className="card-kicker">SUBJECT COMPARISON</span><h2>By subject</h2><p>Attendance from finalized records.</p></div><span className="chart-type"><BarChart3 size={14} />Subjects</span></div>{subjects.filter((subject) => subject.attendancePercent != null).length ? <div className="insight-subject-list">{subjects.filter((subject) => subject.attendancePercent != null).map((subject) => <div className="insight-subject-row" key={subject.id}><div><strong>{subject.name}</strong><small>{subject.code}</small></div><div className="attendance-progress"><span style={{ width: `${subject.attendancePercent}%` }} /></div><b>{subject.attendancePercent}%</b></div>)}</div> : <div className="chart-empty"><h3>No finalized subject data</h3><p>Attendance comparison appears after Present or Absent confirmations.</p></div>}</section></div>
        <section className="card below-target-card"><div className="below-target-heading"><span className="below-target-icon"><Target size={18} /></span><div><h2>Subjects below your target</h2><p>Subjects that need a little extra attention.</p></div></div>{belowTarget.length ? <div className="below-target-list">{belowTarget.map((subject) => <div className="below-target-row" key={subject.id}><strong>{subject.name} <small>{subject.code}</small></strong><span>{subject.attendancePercent}% / target {subject.targetPercent}%</span></div>)}</div> : <div className="below-target-empty"><EmptyState icon={Target} title="No subjects below target" description="This comparison uses your configured subject or semester targets." /></div>}</section></>}
    <section className="card insight-note"><div className="insight-note-icon"><ChartNoAxesCombined size={17} /></div><p>All insights use real saved records. Attendance percentage is Present / (Present + Absent); Pending and Cancelled are excluded.</p></section>
  </>;
}
