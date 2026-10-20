const relevant = (items) => items.filter((item) => item.status === 'Present' || item.status === 'Absent');
export function getAttendancePercentage(items) {
  const classes = relevant(items);
  return classes.length ? Math.round((classes.filter((item) => item.status === 'Present').length / classes.length) * 100) : null;
}
export function getAttendanceCounts(items) {
  return {
    present: items.filter((item) => item.status === 'Present').length,
    absent: items.filter((item) => item.status === 'Absent').length,
    pending: items.filter((item) => item.status === 'Pending').length,
    cancelled: items.filter((item) => item.status === 'Cancelled').length,
    finalized: relevant(items).length,
  };
}
