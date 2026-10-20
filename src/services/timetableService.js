import { apiRequest } from './apiClient.js';
export const getSemesterTimetable = () => apiRequest('/timetable');
export const createTimetableEntry = (entry) => apiRequest('/timetable/entries', { method: 'POST', body: JSON.stringify(entry) });
export const updateTimetableEntry = (id, entry) => apiRequest(`/timetable/entries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(entry) });
export const deleteTimetableEntry = (id) => apiRequest(`/timetable/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const createHoliday = (holiday) => apiRequest('/timetable/holidays', { method: 'POST', body: JSON.stringify(holiday) });
export const cancelClass = (id, details) => apiRequest(`/timetable/classes/${encodeURIComponent(id)}/cancellation`, { method: 'POST', body: JSON.stringify(details) });
