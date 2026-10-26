import { localRequest } from './localAttendanceRepository.js';

const filters = (query) => Object.fromEntries(new URLSearchParams(String(query || '').replace(/^\?/, '')));
export const getClassOccurrences = (date) => localRequest('attendance.classes', { date });
export const generateClassOccurrences = (date) => localRequest('attendance.generate', { date });
export const getAttendanceHistory = (query = '') => localRequest('attendance.history', filters(query));
export const updateAttendanceStatus = (id, change) => localRequest('attendance.update', { id, ...change });
export const deleteAttendanceRecord = (id) => localRequest('attendance.delete', { id });
export const applyBulkAttendanceChanges = (date, changes) => localRequest('attendance.bulk', { date, changes });
export const submitDailyAttendance = (submission) => localRequest('attendance.submit', submission);
export const getDashboardStatistics = () => localRequest('attendance.dashboard');
export const getAttendanceSubjects = () => localRequest('attendance.subjects');
export const getAttendanceInsights = (query = '') => localRequest('attendance.insights', filters(query));
export const resetAttendanceRecords = () => localRequest('attendance.reset');
