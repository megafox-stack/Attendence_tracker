import test from 'node:test';
import assert from 'node:assert/strict';
import { guessAttendanceColumns, normalizeImportDate, normalizeImportStatus, parseClassPeriod, readAttendanceImport } from './attendanceImport.js';

test('CSV parser respects quoted commas, escaped quotes, and line breaks', async () => {
  const file = { name: 'attendance.csv', size: 100, text: async () => 'Subject,Date,Class period,Status,Note\r\n"Signals, Systems",2026-10-31,"9:00 AM - 10:00 AM",Present,"Room ""A"""' };
  const data = await readAttendanceImport(file);
  assert.equal(data.headers.length, 5);
  assert.deepEqual(data.rows[0].values, ['Signals, Systems', '2026-10-31', '9:00 AM - 10:00 AM', 'Present', 'Room "A"']);
});

test('import column guessing returns null when a required header is absent', () => {
  assert.deepEqual(guessAttendanceColumns(['Course', 'Class Date', 'Time Slot', 'Attendance']), {
    subject: 0, date: 1, period: 2, status: 3,
  });
  assert.equal(guessAttendanceColumns(['Date']).subject, null);
});

test('date, class period, and status values normalize for staged records', () => {
  assert.equal(normalizeImportDate('31/10/2026'), '2026-10-31');
  assert.equal(normalizeImportDate(46296), '2026-10-01');
  assert.deepEqual(parseClassPeriod('9:00 AM - 10:15 AM'), { start: '09:00', end: '10:15' });
  assert.equal(normalizeImportStatus('canceled'), 'Cancelled');
  assert.deepEqual(parseClassPeriod('Period 2'), { start: '', end: '' });
});
