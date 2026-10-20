import { apiRequest } from './apiClient.js';
export const getSubjects = () => apiRequest('/subjects');
export const createSubject = (subject) => apiRequest('/subjects', { method: 'POST', body: JSON.stringify(subject) });
export const updateSubject = (id, subject) => apiRequest(`/subjects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(subject) });
export const deleteSubject = (id) => apiRequest(`/subjects/${encodeURIComponent(id)}`, { method: 'DELETE' });
