import { ArrowRight, Bell, CalendarDays, ChevronRight, CircleHelp, Clock3, Gauge, ListChecks, Settings2, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, Notice, PageHeading, SectionTitle } from '../App.jsx';

function Metric({ icon: Icon, label, value, accent = '' }) {
  return <div className="overview-metric"><span className={`metric-icon ${accent}`}><Icon size={16} /></span><span className="metric-text"><small>{label}</small><strong>{value}</strong></span></div>;
}

export default function HomePage() {
  return <><PageHeading eyebrow="YOUR OVERVIEW" title="Welcome" description="Stay consistent. Your attendance builds your future." />
    <section className="card overview-card"><div className="overview-top"><div className="overview-copy"><span className="card-kicker">OVERALL ATTENDANCE</span><div className="percentage-line"><strong>—</strong><span>Not available yet</span></div><p>Your overall percentage appears when you have connected attendance records.</p></div><div className="progress-ring ring-empty" role="img" aria-label="No attendance data"><div><Gauge size={21} /><span>—</span></div></div></div>
      <div className="overview-divider" /><div className="metrics-grid"><Metric icon={TrendingUp} label="Present" value="—" accent="metric-green" /><Metric icon={CircleHelp} label="Absent" value="—" accent="metric-red" /><Metric icon={Clock3} label="Pending" value="—" accent="metric-amber" /><Metric icon={CalendarDays} label="Cancelled" value="—" accent="metric-slate" /></div></section>
    <div className="home-columns"><div className="stack-column"><section className="card scheduler-home"><div className="scheduler-symbol"><CalendarDays size={19} /></div><div className="scheduler-copy"><div className="card-title-line"><h2>Automatic scheduler</h2><span className="state-pill state-neutral"><span />Not configured</span></div><p>Creates Pending records from your saved timetable. Backend connection required.</p></div><Link className="arrow-link" to="/timetable" aria-label="Open timetable setup"><ChevronRight size={18} /></Link></section>
      <section className="card review-banner"><span className="review-icon"><ListChecks size={19} /></span><div className="review-copy"><strong>End of day review</strong><p>Review or correct today's attendance in one place.</p></div><Link to="/review" className="text-link">Review <ArrowRight size={14} /></Link></section>
      <section className="card alert-card"><div className="alert-icon"><Bell size={17} /></div><div><h2>Attendance alerts</h2><p>Notifications will appear here when real attendance records are connected.</p></div><span className="alert-label">No active alerts</span></section></div>
      <section className="card today-card"><SectionTitle title="Today's classes" action={<Link to="/timetable" className="subtle-link">Timetable <ArrowRight size={14} /></Link>} /><EmptyState icon={CalendarDays} title="No classes to show" description="Today's schedule will appear here after your timetable is connected." action={<Link className="button button-secondary button-small" to="/timetable"><Settings2 size={14} />Configure timetable</Link>} /></section></div>
    <section className="card next-card"><div className="next-icon"><Clock3 size={18} /></div><div className="next-copy"><span className="card-kicker">UP NEXT</span><h2>Your next class will show up here</h2><p>Add a timetable and connect the attendance service to see upcoming classes.</p></div><Link className="next-action" to="/timetable">View timetable <ChevronRight size={15} /></Link></section>
  </>;
}
