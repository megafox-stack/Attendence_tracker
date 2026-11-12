import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSubjectName, parseTimetableOcr } from './timetableOcr.js';

const line = (text, x, y) => ({ text, centerX: x, centerY: y, left: x - 0.03, right: x + 0.03, top: y - 0.01, bottom: y + 0.01 });
const lineBox = (text, x, y, left, right) => ({ ...line(text, x, y), left, right });

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

test('reads a scanned grid with weekday rows and vertically split time headers', () => {
  const lines = [
    line('07-09-2026', 0.5, 0.02),
    line('MON', 0.03, 0.32), line('TUE', 0.03, 0.39), line('WED', 0.03, 0.47), line('THU', 0.03, 0.55), line('FRI', 0.03, 0.63),
  ];
  const headers = [
    ['8.00', '9.00'], ['9.00', '10.00'], ['10.00', '10.30'], ['10.30', '11.30'], ['11.30', '12.30'], ['1.30', '2.30'],
  ];
  headers.forEach(([start, end], index) => {
    const x = 0.13 + index * 0.1;
    lines.push(line(start, x, 0.08), line('to', x, 0.10), line(end, x, 0.12));
  });
  lines.push(
    // Monday OCR boxes sit near the top of the row, above the old midpoint band.
    line('DIP Maths', 0.13, 0.275), line('Maths (327)', 0.23, 0.275), line('Tea Break', 0.33, 0.275),
    lineBox('AEC LAB (AR+BS)-B1', 0.48, 0.275, 0.465, 0.495), line('DS (312)', 0.63, 0.275),
    line('AEC (306)', 0.13, 0.39), line('Maths (306)', 0.23, 0.39), line('Tea Break', 0.33, 0.39),
    line('DS (306)', 0.13, 0.47), line('NA (306)', 0.23, 0.47), line('Tea Break', 0.33, 0.47),
    line('Maths (306)', 0.13, 0.55), line('DSDV (306)', 0.23, 0.55), line('Tea Break', 0.33, 0.55),
    line('DS (306)', 0.13, 0.63), line('DSDV (306)', 0.23, 0.63), line('Tea Break', 0.33, 0.63),
  );

  const result = parseTimetableOcr(lines);
  assert.deepEqual(result.detectedDates, ['07-09-2026']);
  assert.equal(result.entries.length, 12);
  assert.deepEqual(result.entries.slice(0, 4).map(({ day, subjectName, start, end, room }) => [day, subjectName, start, end, room]), [
    ['Monday', 'DIP Maths', '08:00', '09:00', ''],
    ['Monday', 'Maths', '09:00', '10:00', '327'],
    ['Monday', 'AEC LAB', '10:30', '12:30', 'B1'],
    ['Monday', 'DS', '13:30', '14:30', '312'],
  ]);
  assert.ok(!result.entries.some((entry) => /tea break/i.test(entry.subjectName)));
  assert.ok(result.entries.some((entry) => entry.day === 'Friday' && entry.start === '08:00'));
});

test('keeps separate class cells when OCR groups a full weekday row into one line', () => {
  const word = (text, x, y) => line(text, x, y);
  const row = (text, elements, y) => ({ ...lineBox(text, 0.4, y, 0.1, 0.7), elements });
  const result = parseTimetableOcr([
    line('MON', 0.03, 0.3), line('TUE', 0.03, 0.5),
    ...[['8.00', '9.00'], ['9.00', '10.00'], ['10.00', '11.00'], ['11.00', '12.00'], ['12.00', '13.00']]
      .map(([start, end], index) => line(`${start} to ${end}`, 0.15 + index * 0.13, 0.1)),
    row('Maths Tea Break AEC LAB Network Analysis', [
      word('Maths', 0.15, 0.3), word('Tea', 0.28, 0.3), word('Break', 0.28, 0.3),
      word('AEC', 0.475, 0.3), word('LAB', 0.475, 0.3), word('Network', 0.67, 0.3), word('Analysis', 0.67, 0.3),
    ], 0.3),
    row('Digital Electronics Signals', [word('Digital', 0.15, 0.5), word('Electronics', 0.15, 0.5), word('Signals', 0.67, 0.5)], 0.5),
  ]);

  assert.deepEqual(result.entries.map(({ day, subjectName, start, end }) => [day, subjectName, start, end]), [
    ['Monday', 'Maths', '08:00', '09:00'],
    ['Monday', 'AEC LAB', '10:00', '12:00'],
    ['Monday', 'Network Analysis', '12:00', '13:00'],
    ['Tuesday', 'Digital Electronics', '08:00', '09:00'],
    ['Tuesday', 'Signals', '12:00', '13:00'],
  ]);
});

test('splits text across timetable cells and ignores the printed DAYS column label', () => {
  const result = parseTimetableOcr([
    line('MON', 0.03, 0.3), line('TUE', 0.03, 0.5),
    line('8.00 to 9.00', 0.2, 0.1), line('9.00 to 10.00', 0.4, 0.1), line('10.00 to 11.00', 0.6, 0.1),
    { ...lineBox('DAYS DIP maths', 0.135, 0.3, 0.02, 0.25), elements: [line('DAYS', 0.05, 0.3), line('DIP', 0.18, 0.3), line('maths', 0.22, 0.3)] },
    { ...lineBox('DS AEC', 0.44, 0.3, 0.35, 0.53), elements: [line('DS', 0.4, 0.3), line('AEC', 0.52, 0.3)] },
  ]);

  assert.deepEqual(result.entries.map(({ subjectName, start, end }) => [subjectName, start, end]), [
    ['DIP maths', '08:00', '09:00'],
    ['DS', '09:00', '10:00'],
    ['AEC', '10:00', '11:00'],
  ]);
});

test('finds weekday and vertically stacked time headings inside grouped OCR lines', () => {
  const word = (text, x, y) => line(text, x, y);
  const headingElements = [];
  [['8.00', '9.00'], ['9.00', '10.00'], ['10.00', '11.00']].forEach(([start, end], index) => {
    const x = 0.2 + index * 0.2;
    headingElements.push(word(start, x, 0.08), word('to', x, 0.1), word(end, x, 0.12));
  });
  const result = parseTimetableOcr([
    { ...line('MON TUE', 0.03, 0.4), elements: [word('MON', 0.03, 0.3), word('TUE', 0.03, 0.5)] },
    { ...line('8.00 to 9.00 9.00 to 10.00 10.00 to 11.00', 0.4, 0.1), elements: headingElements },
    line('Mathematics', 0.2, 0.3), line('Electronics', 0.4, 0.3), line('Networks', 0.6, 0.3),
    line('Signals', 0.2, 0.5), line('Data Structures', 0.6, 0.5),
  ]);

  assert.deepEqual(result.entries.map(({ day, subjectName, start, end }) => [day, subjectName, start, end]), [
    ['Monday', 'Mathematics', '08:00', '09:00'],
    ['Monday', 'Electronics', '09:00', '10:00'],
    ['Monday', 'Networks', '10:00', '11:00'],
    ['Tuesday', 'Signals', '08:00', '09:00'],
    ['Tuesday', 'Data Structures', '10:00', '11:00'],
  ]);
});

test('keeps separate lab groups and parses room tags out of subject labels', () => {
  const result = parseTimetableOcr([
    line('MON', 0.03, 0.3), line('TUE', 0.03, 0.5),
    line('10.30 to 11.30', 0.4, 0.1), line('11.30 to 12.30', 0.6, 0.1),
    line('AEC LAB (AR+BS)-B1', 0.5, 0.25),
    line('DSDV LAB (MR+TR)-B2', 0.5, 0.29),
    line('AECS LABNGGK+RK)-B3', 0.5, 0.33),
  ]);

  assert.deepEqual(result.entries.map(({ subjectName, start, end, room }) => [subjectName, start, end, room]), [
    ['AEC LAB', '10:30', '12:30', 'B1'],
    ['DSDV LAB', '10:30', '12:30', 'B2'],
    ['AECS LAB', '10:30', '12:30', 'B3'],
  ]);
});

test('removes non-room bracket annotations from the subject label', () => {
  const result = parseTimetableOcr([
    line('MON', 0.03, 0.3), line('TUE', 0.03, 0.5),
    line('2.30 to 3.30', 0.4, 0.1), line('3.30 to 4.30', 0.6, 0.1),
    line('Dip Maths (2-4)', 0.4, 0.3), line('Digital Electronics [EDE-101]', 0.6, 0.3),
  ]);
  assert.deepEqual(result.entries.map(({ subjectName, room }) => [subjectName, room]), [['Dip Maths', ''], ['Digital Electronics', '']]);
});

test('matches a clear subject spelling variation but leaves uncertain text unresolved', () => {
  const subjects = [{ id: 'net', name: 'Network Analysis' }, { id: 'math', name: 'Engineering Mathematics' }, { id: 'aec', name: 'Analog Electronics', code: 'AEC' }];
  assert.equal(matchSubjectName('Network Analysis', subjects).id, 'net');
  assert.equal(matchSubjectName('Engineering Math', subjects)?.id || null, 'math');
  assert.equal(matchSubjectName('AEC', subjects)?.id || null, 'aec');
  assert.equal(matchSubjectName('Unknown Lab', subjects), null);
});
