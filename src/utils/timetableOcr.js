const DAY_NAMES = [
  ['Monday', /^(?:mon|monday)$/i], ['Tuesday', /^(?:tue|tues|tuesday)$/i],
  ['Wednesday', /^(?:wed|wednesday)$/i], ['Thursday', /^(?:thu|thur|thurs|thursday)$/i],
  ['Friday', /^(?:fri|friday)$/i], ['Saturday', /^(?:sat|saturday)$/i], ['Sunday', /^(?:sun|sunday)$/i],
];
const BREAK_WORDS = /\b(?:break|lunch|tea|recess|free|interval|no\s*class|self\s*study)\b/i;
const LAB_MARKER = /\bLAB\b|\bLAB[A-Z]/i;
const HEADER_WORDS = /^(?:time|day|days|subject|subjects|room|venue|timetable|weekly\s*timetable|period|slot|date|class)$/i;
const TIME_RANGE = /(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i;
const CLOCK_TOKEN = /^(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?$/i;

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
function clockToken(line) {
  const match = line.text.match(CLOCK_TOKEN);
  if (!match) return null;
  const time = parseClock(match[1], match[2], match[3]);
  return time ? { ...line, time, explicitMeridiem: Boolean(match[3]) } : null;
}
function headerTimeRanges(lines) {
  const ranges = lines.flatMap((line) => {
    const range = timeRange(line.text);
    return range ? [{ ...range, x: line.centerX, y: line.centerY, line, explicitMeridiem: /\b(?:a\.?m\.?|p\.?m\.?)\b/i.test(line.text) }] : [];
  });
  const clocks = lines.map(clockToken).filter(Boolean);
  const connectors = lines.filter((line) => /^(?:to|[-–—])$/i.test(line.text));
  for (const connector of connectors) {
    const close = (clock) => Math.abs(clock.centerX - connector.centerX) <= 0.055;
    const before = clocks.filter((clock) => close(clock) && clock.centerY < connector.centerY && connector.centerY - clock.centerY < 0.09)
      .sort((a, b) => b.centerY - a.centerY)[0];
    const after = clocks.filter((clock) => close(clock) && clock.centerY > connector.centerY && clock.centerY - connector.centerY < 0.09)
      .sort((a, b) => a.centerY - b.centerY)[0];
    if (!before || !after) continue;
    ranges.push({ start: before.time, end: after.time, x: connector.centerX, y: connector.centerY, line: connector,
      explicitMeridiem: before.explicitMeridiem || after.explicitMeridiem });
  }
  // Some OCR engines omit the word “to”. In that case, pair two vertically
  // stacked clock labels that share a header column.
  const paired = new Set();
  for (let i = 0; i < clocks.length; i++) {
    if (paired.has(i)) continue;
    let best = -1; let distance = Infinity;
    for (let j = i + 1; j < clocks.length; j++) {
      if (paired.has(j)) continue;
      const dx = Math.abs(clocks[i].centerX - clocks[j].centerX);
      const dy = clocks[j].centerY - clocks[i].centerY;
      if (dy <= 0 || dy > 0.09 || dx > 0.035 || dy >= distance) continue;
      distance = dy; best = j;
    }
    if (best < 0) continue;
    const first = clocks[i], second = clocks[best];
    const alreadyPaired = ranges.some((range) => Math.abs(range.x - (first.centerX + second.centerX) / 2) < 0.035
      && Math.abs(range.y - (first.centerY + second.centerY) / 2) < 0.055);
    if (!alreadyPaired) ranges.push({ start: first.time, end: second.time, x: (first.centerX + second.centerX) / 2,
      y: (first.centerY + second.centerY) / 2, line: first, explicitMeridiem: first.explicitMeridiem || second.explicitMeridiem });
    paired.add(i); paired.add(best);
  }
  const unique = new Map();
  for (const range of ranges) {
    const key = `${range.start}|${range.end}|${Math.round(range.x * 1000)}`;
    if (!unique.has(key)) unique.set(key, range);
  }
  return [...unique.values()];
}
function minuteValue(value) { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; }
function clockValue(value) { const hour = Math.floor(value / 60); const minute = value % 60; return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`; }
function chronologicalGridRanges(ranges) {
  let previousStart = -1;
  return ranges.sort((a, b) => a.x - b.x).map((range) => {
    let start = minuteValue(range.start), end = minuteValue(range.end);
    if (!range.explicitMeridiem) {
      while (start <= previousStart && start + 720 < 24 * 60) { start += 720; end += 720; }
      while (end <= start && end + 720 < 24 * 60) end += 720;
    }
    previousStart = start;
    return { ...range, start: clockValue(start), end: clockValue(end) };
  });
}
function slotSpanForLine(line, slots, allowMerged = true) {
  const left = Number.isFinite(line.left) ? line.left : line.centerX;
  const right = Number.isFinite(line.right) ? line.right : line.centerX;
  const covered = slots.map((slot, index) => slot.x >= left && slot.x <= right ? index : -1).filter((index) => index >= 0);
  if (covered.length > 1) return { first: covered[0], last: covered[covered.length - 1] };
  // Labels in a merged table cell tend to be centered between the period
  // headers it spans, even when OCR returns a narrow text box.
  if (allowMerged) {
    for (let index = 0; index < slots.length - 1; index++) {
      const gap = slots[index + 1].x - slots[index].x;
      const midpoint = (slots[index].x + slots[index + 1].x) / 2;
      if (gap > 0 && Math.abs(line.centerX - midpoint) <= gap * 0.16) return { first: index, last: index + 1 };
    }
  }
  let nearest = 0;
  for (let i = 1; i < slots.length; i++) if (Math.abs(slots[i].x - line.centerX) < Math.abs(slots[nearest].x - line.centerX)) nearest = i;
  return { first: nearest, last: nearest };
}
function lineFitsSpan(line, span, slots) {
  const first = slots[span.first], last = slots[span.last];
  const left = Number.isFinite(line.left) ? line.left : line.centerX;
  const right = Number.isFinite(line.right) ? line.right : line.centerX;
  return left >= first.left - 0.006 && right <= last.right + 0.006;
}
function dateLabel(text) {
  const match = text.match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/);
  return match?.[0] || null;
}
function cleanSubjectCell(value) {
  let subjectName = String(value || '').replace(/\s+/g, ' ').trim();
  let room = '';
  const roomMatch = subjectName.match(/\((\d{3,4})\)/);
  if (roomMatch) {
    room = roomMatch[1];
  }
  // Separate short lab/room tags such as B1 from the subject label.
  const roomTag = subjectName.match(/(?:\s*[-–—]\s*|\s+)(B\d{1,2})\s*$/i);
  if (roomTag) {
    room ||= roomTag[1].toUpperCase();
    subjectName = subjectName.slice(0, roomTag.index).trim();
  }
  const leadingRoomTag = subjectName.match(/^\s*(B\d{1,2})\s+(.+)$/i);
  if (leadingRoomTag) {
    room ||= leadingRoomTag[1].toUpperCase();
    subjectName = leadingRoomTag[2].trim();
  }
  // Parenthetical text in timetable subject cells is metadata (room, faculty,
  // batch, or period annotation), not part of the subject name.
  subjectName = subjectName.replace(/\b(LAB)\s*\(?\s*[A-Z]{1,5}(?:\s*\+\s*[A-Z]{1,5})+\s*\)?/gi, '$1')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[)\]]+$/g, '').replace(/\s+/g, ' ').trim();
  return { subjectName, room };
}

/**
 * Converts ML Kit OCR line boxes into a conservative weekly timetable suggestion.
 * It intentionally returns no guessed entries when day columns or time rows are unclear.
 */
export function parseTimetableOcr(rawLines = []) {
  const lines = rawLines.map(normalizedLine).filter((line) => line.text);
  // ML Kit can combine several table headings into one Text.Line. Use its
  // word boxes for geometry and retain the parent line only when words are
  // unavailable (for example, OCR fixtures or older native builds).
  const ocrTokens = lines.flatMap((line) => Array.isArray(line.elements) && line.elements.length
    ? line.elements.map(normalizedLine)
    : [line]);
  const detectedDates = [...new Set(lines.map((line) => dateLabel(line.text)).filter(Boolean))];
  const dayHeaders = ocrTokens.flatMap((line) => {
    const day = dayFor(line.text);
    return day ? [{ day, x: line.centerX, y: line.centerY, line }] : [];
  }).sort((a, b) => a.x - b.x);
  const times = headerTimeRanges(ocrTokens).sort((a, b) => a.y - b.y);
  const uniqueDays = dayHeaders.filter((header, index) => dayHeaders.findIndex((x) => x.day === header.day) === index);
  const warnings = [];
  if (uniqueDays.length < 1) warnings.push('Could not identify weekday column headings. Check that the photo shows the timetable header clearly.');
  if (!times.length) warnings.push('Could not identify complete start–end time ranges. Add or correct class times in the review.');
  if (uniqueDays.length < 1 || !times.length) return { entries: [], detectedDates, warnings };

  const dayX = uniqueDays.map((day) => day.x), dayY = uniqueDays.map((day) => day.y);
  const timeX = times.map((time) => time.x), timeY = times.map((time) => time.y);
  const spread = (values) => Math.max(...values) - Math.min(...values);
  const daysAreRows = uniqueDays.length > 1 && spread(dayY) > spread(dayX) * 1.5;
  const timesAreColumns = times.length > 1 && spread(timeX) > spread(timeY) * 1.5;
  if (daysAreRows && timesAreColumns) {
    const rows = uniqueDays.slice().sort((a, b) => a.y - b.y);
    const slots = chronologicalGridRanges(times.slice());
    const rowBounds = rows.map((row, index) => {
      const previousGap = row.y - (rows[index - 1]?.y ?? row.y);
      const nextGap = (rows[index + 1]?.y ?? row.y) - row.y;
      // OCR text can sit near the top of a row while its weekday label is
      // vertically centered. Use a wider candidate band, then assign each
      // line only to the nearest weekday to avoid duplicating classes.
      return { ...row, top: row.y - (index === 0 ? nextGap : previousGap) * 0.75,
        bottom: row.y + (index === rows.length - 1 ? previousGap : nextGap) * 0.75 };
    });
    const slotBounds = slots.map((slot, index) => {
      const previous = slots[index - 1]?.x, next = slots[index + 1]?.x;
      const gap = next == null ? slot.x - (previous ?? 0) : next - slot.x;
      return { ...slot, left: previous == null ? slot.x - gap / 2 : (previous + slot.x) / 2,
        right: next == null ? slot.x + gap / 2 : (slot.x + next) / 2 };
    });
    const entries = [];
    const compactClock = (text) => {
      if (!/^\d{4}$/.test(text)) return false;
      const hour = Number(text.slice(0, 2)), minute = Number(text.slice(2));
      return hour >= 0 && hour <= 23 && minute <= 59;
    };
    const ignored = (line) => dayFor(line.text) || dateLabel(line.text) || timeRange(line.text) || clockToken(line)
      || compactClock(line.text) || /^(?:to|[-–—])$/i.test(line.text) || HEADER_WORDS.test(line.text);
    const rowContentLines = lines.flatMap((line, parentIndex) => Array.isArray(line.elements) && line.elements.length
      ? line.elements.map((element) => ({ ...normalizedLine(element), parentIndex, parentLine: line }))
      : [{ ...line, parentIndex, parentLine: line }]);
    const rowLineGroups = rowBounds.map(() => []);
    for (const line of rowContentLines) {
      if (ignored(line) || BREAK_WORDS.test(line.text)) continue;
      let nearest = 0;
      for (let index = 1; index < rowBounds.length; index++) {
        if (Math.abs(rowBounds[index].y - line.centerY) < Math.abs(rowBounds[nearest].y - line.centerY)) nearest = index;
      }
      if (line.centerY >= rowBounds[nearest].top && line.centerY <= rowBounds[nearest].bottom) rowLineGroups[nearest].push(line);
    }
    for (const [rowIndex, row] of rowBounds.entries()) {
      const rowLines = rowLineGroups[rowIndex];
      const parentCells = new Map();
      for (const line of rowLines) {
        if (line.parentIndex == null || !Array.isArray(line.parentLine?.elements)
          || parentCells.has(line.parentIndex)) continue;
        const parentLine = line.parentLine;
        const text = parentLine.text.trim();
        if (!text || BREAK_WORDS.test(text) || timeRange(text) || HEADER_WORDS.test(text)) continue;
        const span = slotSpanForLine(parentLine, slotBounds);
        const spanWidth = span.last - span.first;
        const explicitMergedCell = spanWidth === 1
          && (LAB_MARKER.test(text) || /\(\s*\d+\s*[-–—]\s*\d+\s*\)/.test(text) || /^skill\s+development$/i.test(text));
        // If an OCR line fits in one period, keep its complete subject text
        // together. Preserve known merged lab/period cells across two periods.
        if ((spanWidth === 0 || explicitMergedCell) && lineFitsSpan(parentLine, span, slotBounds)) {
          parentCells.set(line.parentIndex, { parentLine, span });
        }
      }
      const consumedParentIds = new Set(parentCells.keys());
      const cellLines = rowLines.filter((line) => !consumedParentIds.has(line.parentIndex));
      const cellGroups = [];
      for (const line of cellLines) {
        const parentSupportsMergedCell = LAB_MARKER.test(line.parentLine?.text || '')
          || /\(\s*\d+\s*[-–—]\s*\d+\s*\)/.test(line.parentLine?.text || '');
        const span = slotSpanForLine(line, slotBounds,
          !Array.isArray(line.parentLine?.elements) || parentSupportsMergedCell);
        let group = cellGroups.find((candidate) => candidate.first === span.first && candidate.last === span.last);
        if (!group) {
          group = { centerX: line.centerX, first: span.first, last: span.last, lines: [] };
          cellGroups.push(group);
        }
        group.first = Math.min(group.first, span.first);
        group.last = Math.max(group.last, span.last);
        group.lines.push(line);
      }
      for (const { parentLine, span } of parentCells.values()) {
        const text = parentLine.text.trim();
        let group = cellGroups.find((candidate) => candidate.first === span.first && candidate.last === span.last);
        if (!group) { group = { centerX: parentLine.centerX, first: span.first, last: span.last, lines: [] }; cellGroups.push(group); }
        group.lines.push({ ...parentLine, text });
      }
      cellGroups.sort((a, b) => a.first - b.first || a.centerX - b.centerX);
      for (const group of cellGroups) {
        const ordered = group.lines.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
        const rowGap = Math.max(0.02, (rowBounds[rowIndex + 1]?.y ?? row.y + 0.08) - row.y);
        const baselineTolerance = rowGap * 0.16;
        const baselines = [];
        for (const line of ordered) {
          let baseline = baselines.find((item) => Math.abs(item.centerY - line.centerY) <= baselineTolerance);
          if (!baseline) { baseline = { centerY: line.centerY, lines: [] }; baselines.push(baseline); }
          baseline.lines.push(line);
        }
        const textLines = baselines.map((baseline) => baseline.lines.sort((a, b) => a.centerX - b.centerX)
          .map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
        const labLines = textLines.filter((text) => LAB_MARKER.test(text));
        // Lab cells commonly list parallel lab groups on separate printed
        // lines. Keep those suggestions separate instead of making one long,
        // incorrect subject name. The user can remove groups that do not
        // apply to their section during the existing review step.
        const subjectNames = labLines.length > 1 ? labLines : [textLines.join(' ').trim()];
        for (const rawSubjectName of subjectNames) {
          const { subjectName, room } = cleanSubjectCell(rawSubjectName);
          if (!subjectName) continue;
          entries.push({ day: row.day, subjectName, subjectId: '', start: slotBounds[group.first].start,
            end: slotBounds[group.last].end, room });
        }
      }
    }
    if (!entries.length) warnings.push('No class cells could be read confidently. The existing timetable has not been changed.');
    return { entries, detectedDates, warnings };
  }

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
    if (key === other || key === subjectKey(subject.code)) return { subject, score: 1 };
    const a = bigrams(key), b = bigrams(other);
    let common = 0; for (const item of a) if (b.has(item)) common++;
    const dice = a.size + b.size ? (2 * common) / (a.size + b.size) : 0;
    const contains = key.includes(other) || other.includes(key) ? Math.min(key.length, other.length) / Math.max(key.length, other.length) : 0;
    return { subject, score: Math.max(dice, contains) };
  }).sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 0.78 || (scored[1] && scored[0].score - scored[1].score < 0.08)) return null;
  return scored[0].subject;
}
