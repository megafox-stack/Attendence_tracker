import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSubjectName, parseTimetableOcr } from './timetableOcr.js';

const line = (text, x, y) => ({ text, centerX: x, centerY: y, left: x - 0.03, right: x + 0.03, top: y - 0.01, bottom: y + 0.01 });

test('extracts day/time cells and excludes break rows', () => {
  const result = parseTimetableOcr([
    line('Monday', 0.35, 0.1), line('Tuesday', 0.68, 0.1),
    line('9:00 AM - 10:00 AM', 0.08, 0.3), line('Network Analysis', 0.35, 0.3), line('Signals', 0.68, 0.3),
    line('10:00 AM - 10:30 AM', 0.08, 0.5), line('Lunch Break', 0.35, 0.5),
    line('10:30 AM - 11:30 AM', 0.08, 0.7), line('Electronics', 0.35, 0.7), line('Maths', 0.68, 0.7),
  ]);
  assert.deepEqual(result.entries.map(({ day, subjectName, start, end }) => ({ day, subjectName, start, end })), [
    { day: 'Monday', subjectName: 'Network Analysis', start: '09:00', end: '10:00' },
    { day: 'Tuesday', subjectName: 'Signals', start: '09:00', end: '10:00' },
    { day: 'Monday', subjectName: 'Electronics', start: '10:30', end: '11:30' },
    { day: 'Tuesday', subjectName: 'Maths', start: '10:30', end: '11:30' },
  ]);
});

test('does not guess when weekdays or complete time intervals are missing', () => {
  const result = parseTimetableOcr([line('Monday', 0.5, 0.2), line('Algorithms', 0.5, 0.5)]);
  assert.equal(result.entries.length, 0);
  assert.ok(result.warnings.length);
});

test('normalizes meridiem times, including a range whose suffix follows the end time', () => {
  const result = parseTimetableOcr([
    line('Thursday', 0.5, 0.1), line('11:00 - 1:00 PM', 0.08, 0.3), line('Circuits', 0.5, 0.3),
    line('12:00 PM - 1:00 PM', 0.08, 0.6), line('Networks', 0.5, 0.6),
  ]);
  assert.deepEqual(result.entries.map((entry) => [entry.start, entry.end]), [['11:00', '13:00'], ['12:00', '13:00']]);
});

test('matches a clear subject spelling variation but leaves uncertain text unresolved', () => {
  const subjects = [{ id: 'net', name: 'Network Analysis' }, { id: 'math', name: 'Engineering Mathematics' }];
  assert.equal(matchSubjectName('Network Analysis', subjects).id, 'net');
  assert.equal(matchSubjectName('Engineering Math', subjects)?.id || null, 'math');
  assert.equal(matchSubjectName('Unknown Lab', subjects), null);
});
