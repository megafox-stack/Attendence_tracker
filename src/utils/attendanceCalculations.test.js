import test from 'node:test';
import assert from 'node:assert/strict';
import { getAttendanceCounts, getAttendancePercentage } from './attendanceCalculations.js';

test('attendance percentage excludes pending and cancelled records', () => {
  const records = [
    { status: 'Present' }, { status: 'Present' }, { status: 'Absent' },
    { status: 'Pending' }, { status: 'Cancelled' },
  ];
  assert.equal(getAttendancePercentage(records), 67);
  assert.deepEqual(getAttendanceCounts(records), { present: 2, absent: 1, pending: 1, cancelled: 1, finalized: 3 });
});

test('no attendance denominator returns no percentage', () => {
  assert.equal(getAttendancePercentage([{ status: 'Pending' }, { status: 'Cancelled' }]), null);
});
