import { apiRequest } from './apiClient.js';
export const getSemesterTimetable = () => apiRequest('/timetable');
export async function createTimetableEntry(entry) {
  const result = await apiRequest('/timetable/entries', { method: 'POST', body: JSON.stringify(entry) });
  return result.entry;
}
export async function updateTimetableEntry(id, entry) {
  const result = await apiRequest(`/timetable/entries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(entry) });
  return result.entry;
}
export const setTimetableEntryActive = (id, active) => apiRequest(`/timetable/entries/${encodeURIComponent(id)}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
export const deleteTimetableEntry = (id) => apiRequest(`/timetable/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const createHoliday = (holiday) => apiRequest('/timetable/holidays', { method: 'POST', body: JSON.stringify(holiday) });
export const deleteHoliday = (id) => apiRequest(`/timetable/holidays/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const cancelClass = (id, details) => apiRequest(`/timetable/classes/${encodeURIComponent(id)}/cancellation`, { method: 'POST', body: JSON.stringify(details) });
