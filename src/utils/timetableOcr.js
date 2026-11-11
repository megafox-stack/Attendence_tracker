const DAY_NAMES = [
  ['Monday', /^(?:mon|monday)$/i], ['Tuesday', /^(?:tue|tues|tuesday)$/i],
  ['Wednesday', /^(?:wed|wednesday)$/i], ['Thursday', /^(?:thu|thur|thurs|thursday)$/i],
  ['Friday', /^(?:fri|friday)$/i], ['Saturday', /^(?:sat|saturday)$/i], ['Sunday', /^(?:sun|sunday)$/i],
];
const BREAK_WORDS = /\b(?:break|lunch|tea|recess|free|interval|no\s*class|self\s*study)\b/i;
const HEADER_WORDS = /^(?:time|day|subject|subjects|room|venue|timetable|weekly\s*timetable|period|slot|date|class)$/i;
const TIME_RANGE = /(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i;

function normalizedLine(line) {
  const text = String(line?.text || '').replace(/\s+/g, ' ').trim();
  return { ...line, text, centerX: Number.isFinite(line?.centerX) ? line.centerX : ((line?.left || 0) + (line?.right || 0)) / 2,
    centerY: Number.isFinite(line?.centerY) ? line.centerY : ((line?.top || 0) + (line?.bottom || 0)) / 2 };
}
function dayFor(text) {
  const clean = text.replace(/[.,:]/g, '').trim();
  const token = clean.match(/^[a-z]+/i)?.[0] || clean;
  return DAY_NAMES.find(([, pattern]) => pattern.test(token))?.[0] || null;
}
function parseClock(hourValue, minuteValue, marker) {
  let hour = Number(hourValue); const minute = Number(minuteValue);
  if (minute > 59 || hour > 23 || hour < 0) return null;
  const suffix = (marker || '').replace(/[.\s]/g, '').toLowerCase();
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix.startsWith('p') && hour !== 12) hour += 12;
    if (suffix.startsWith('a') && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function timeRange(text) {
  const match = text.match(TIME_RANGE);
  if (!match) return null;
  const firstHour = Number(match[1]); const secondHour = Number(match[4]);
  const firstMarker = match[3] || (match[6]?.toLowerCase().startsWith('p') && firstHour > secondHour ? 'am' : match[6]) || '';
  const secondMarker = match[6] || match[3] || '';
  const start = parseClock(match[1], match[2], firstMarker);
  const end = parseClock(match[4], match[5], secondMarker);
  return start && end && end > start ? { start, end } : null;
}
function dateLabel(text) {
  const match = text.match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/);
  return match?.[0] || null;
}

/**
 * Converts ML Kit OCR line boxes into a conservative weekly timetable suggestion.
 * It intentionally returns no guessed entries when day columns or time rows are unclear.
 */
export function parseTimetableOcr(rawLines = []) {
  const lines = rawLines.map(normalizedLine).filter((line) => line.text);
  const detectedDates = [...new Set(lines.map((line) => dateLabel(line.text)).filter(Boolean))];
  const dayHeaders = lines.flatMap((line) => {
    const day = dayFor(line.text);
    return day ? [{ day, x: line.centerX, y: line.centerY, line }] : [];
  }).sort((a, b) => a.x - b.x);
  const times = lines.flatMap((line) => {
    const range = timeRange(line.text);
    return range ? [{ ...range, y: line.centerY, line }] : [];
  }).sort((a, b) => a.y - b.y);
  const uniqueDays = dayHeaders.filter((header, index) => dayHeaders.findIndex((x) => x.day === header.day) === index);
  const warnings = [];
  if (uniqueDays.length < 1) warnings.push('Could not identify weekday column headings. Check that the photo shows the timetable header clearly.');
  if (!times.length) warnings.push('Could not identify complete start–end time ranges. Add or correct class times in the review.');
  if (uniqueDays.length < 1 || !times.length) return { entries: [], detectedDates, warnings };

  const dayBounds = uniqueDays.map((header, index) => {
    const gapBefore = index > 0 ? header.x - uniqueDays[index - 1].x : (uniqueDays[index + 1]?.x - header.x || 1);
    const gapAfter = index < uniqueDays.length - 1 ? uniqueDays[index + 1].x - header.x : (header.x - uniqueDays[index - 1]?.x || 1);
    return { ...header, left: index === 0 ? header.x - gapBefore / 2 : (uniqueDays[index - 1].x + header.x) / 2,
      right: index === uniqueDays.length - 1 ? header.x + gapAfter / 2 : (header.x + uniqueDays[index + 1].x) / 2 };
  });
  const slots = times.map((slot, index) => {
    const previous = times[index - 1]?.y;
    const next = times[index + 1]?.y;
    return { ...slot, top: previous == null ? slot.y - (next == null ? 0.035 : (next - slot.y) / 2) : (previous + slot.y) / 2,
      bottom: next == null ? slot.y + (previous == null ? 0.035 : (slot.y - previous) / 2) : (slot.y + next) / 2 };
  });

  const entries = [];
  const seen = new Set();
  for (const slot of slots) {
    const rowLines = lines.filter((line) => line.centerY >= slot.top && line.centerY <= slot.bottom);
    if (rowLines.some((line) => BREAK_WORDS.test(line.text))) continue;
    const timeColumnDay = dayBounds.find((day) => slot.line.centerX >= day.left && slot.line.centerX < day.right)?.day;
    for (const day of dayBounds.filter((item) => !timeColumnDay || item.day === timeColumnDay)) {
      const cellLines = rowLines.filter((line) => line.centerX >= day.left && line.centerX < day.right
        && line !== day.line && !dayFor(line.text) && !timeRange(line.text) && !HEADER_WORDS.test(line.text));
      if (!cellLines.length) continue;
      const subjectName = cellLines.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX).map((line) => line.text).join(' ').trim();
      if (!subjectName || BREAK_WORDS.test(subjectName) || HEADER_WORDS.test(subjectName)) continue;
      const key = `${day.day}|${slot.start}|${slot.end}|${subjectName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ day: day.day, subjectName, subjectId: '', start: slot.start, end: slot.end, room: '' });
    }
  }
  if (!entries.length) warnings.push('No class cells could be read confidently. The existing timetable has not been changed.');
  return { entries, detectedDates, warnings };
}

function subjectKey(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function bigrams(value) { const text = ` ${subjectKey(value)} `; const out = new Set(); for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2)); return out; }
export function matchSubjectName(name, subjects = []) {
  const key = subjectKey(name);
  if (!key) return null;
  const scored = subjects.map((subject) => {
    const other = subjectKey(subject.name);
    if (key === other) return { subject, score: 1 };
    const a = bigrams(key), b = bigrams(other);
    let common = 0; for (const item of a) if (b.has(item)) common++;
    const dice = a.size + b.size ? (2 * common) / (a.size + b.size) : 0;
    const contains = key.includes(other) || other.includes(key) ? Math.min(key.length, other.length) / Math.max(key.length, other.length) : 0;
    return { subject, score: Math.max(dice, contains) };
  }).sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 0.78 || (scored[1] && scored[0].score - scored[1].score < 0.08)) return null;
  return scored[0].subject;
}
