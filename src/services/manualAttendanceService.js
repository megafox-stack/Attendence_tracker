import { localRequest } from './localAttendanceRepository.js';

export async function getManualAttendanceDraft() {
  const result = await localRequest('manual.draft.get');
  try { return JSON.parse(result.value || '[]'); }
  catch { return []; }
}

export const saveManualAttendanceDraft = (items) =>
  localRequest('manual.draft.save', { items });

export const validateManualAttendance = (items) =>
  localRequest('manual.validate', { items });

export const commitManualAttendance = (items) =>
  localRequest('manual.commit', { items });

export const clearManualAttendanceDraft = () =>
  localRequest('manual.draft.clear');
