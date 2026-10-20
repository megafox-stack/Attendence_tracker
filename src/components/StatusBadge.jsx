import { Circle, CircleCheck, CircleX, Clock3, Minus } from 'lucide-react';
const statusIcons = { Pending: Clock3, Present: CircleCheck, Absent: CircleX, Cancelled: Minus };
export default function StatusBadge({ status }) {
  const Icon = statusIcons[status] || Circle;
  return <span className={`status-badge status-${String(status || 'pending').toLowerCase()}`}><Icon size={13} />{status}</span>;
}
