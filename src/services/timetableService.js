import { localRequest } from './localAttendanceRepository.js';

export const getSemesterTimetable = () => localRequest('timetable.get');
export async function createTimetableEntry(entry) { return (await localRequest('timetable.create', entry)).entry; }
export async function updateTimetableEntry(id, entry) { return (await localRequest('timetable.update', { id, ...entry })).entry; }
export const setTimetableEntryActive = (id, active) => localRequest('timetable.active', { id, active });
export const deleteTimetableEntry = (id) => localRequest('timetable.delete', { id });
export const importTimetable = (mode, entries) => localRequest('timetable.import', { mode, entries });
export const clearTimetable = () => localRequest('timetable.clear');
export async function createHoliday(holiday) { return (await localRequest('holiday.create', holiday)).holiday; }
export const deleteHoliday = (id) => localRequest('holiday.delete', { id });
export async function cancelClass(id, details = {}) { return localRequest('attendance.update', { id, status: 'Cancelled', reason: details.reason || details.note || '' }); }
