function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  return rows;
}

export async function readAttendanceImport(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let matrix;
  if (extension === 'csv') {
    matrix = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
  } else if (extension === 'xlsx') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('The workbook does not contain a worksheet.');
    matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' });
  } else {
    throw new Error('Choose a .csv or .xlsx file. Legacy .xls files are not supported.');
  }

  if (!matrix.length || matrix.length < 2) throw new Error('The file needs a header row and at least one attendance row.');
  const headers = matrix[0].map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`);
  const rows = matrix.slice(1).filter((values) => values.some((value) => String(value ?? '').trim() !== ''))
    .slice(0, 500).map((values, index) => ({ rowNumber: index + 2, values: headers.map((_, column) => values[column] ?? '') }));
  if (!rows.length) throw new Error('The file does not contain any attendance rows.');
  return { headers, rows, truncated: matrix.length - 1 > 500, fileName: file.name, extension };
}

export function guessAttendanceColumns(headers) {
  const find = (pattern) => {
    const index = headers.findIndex((header) => pattern.test(header));
    return index < 0 ? null : index;
  };
  return {
    subject: find(/subject|course|code/i),
    date: find(/date|day/i),
    period: find(/period|session|time|slot/i),
    status: find(/status|attendance|present|absent/i),
  };
}

function excelSerialToDate(value) {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days) || days < 1 || days > 100000) return '';
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  return date.toISOString().slice(0, 10);
}

export function normalizeImportDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw)) {
    const [year, month, day] = raw.split(/[-/.]/).map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : raw;
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw)) {
    const [first, second, year] = raw.split(/[/-]/).map(Number);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : raw;
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) return excelSerialToDate(Number(raw)) || raw;
  return raw;
}

function normalizeClock(value) {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const raw = String(value ?? '').trim().toUpperCase().replace('.', ':');
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 23) return '';
  if (match[3]) {
    if (hour < 1 || hour > 12) return '';
    hour = (hour % 12) + (match[3] === 'PM' ? 12 : 0);
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseClassPeriod(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)/i);
  if (!match) return { start: '', end: '' };
  return { start: normalizeClock(match[1]), end: normalizeClock(match[2]) };
}

export function normalizeImportStatus(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const aliases = { present: 'Present', p: 'Present', attended: 'Present', absent: 'Absent', a: 'Absent', pending: 'Pending', cancelled: 'Cancelled', canceled: 'Cancelled', holiday: 'Holiday' };
  return aliases[raw] || String(value ?? '').trim();
}
