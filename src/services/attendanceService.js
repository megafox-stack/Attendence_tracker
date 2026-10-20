import { apiRequest } from './apiClient.js';
export const getClassOccurrences = (query = '') => apiRequest(`/attendance/classes${query}`);
export const getAttendanceHistory = (query = '') => apiRequest(`/attendance/history${query}`);
export const updateAttendanceStatus = (id, change) => apiRequest(`/attendance/classes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(change) });
export const applyBulkAttendanceChanges = (changes) => apiRequest('/attendance/bulk', { method: 'POST', body: JSON.stringify({ changes }) });
export const submitDailyAttendance = (submission) => apiRequest('/attendance/daily-submission', { method: 'POST', body: JSON.stringify(submission) });
export const getDashboardStatistics = () => apiRequest('/attendance/dashboard');
