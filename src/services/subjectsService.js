import { apiRequest } from './apiClient.js';

export async function getSubjects() {
  const result = await apiRequest('/subjects');
  return result.subjects;
}

export async function createSubject(subject) {
  const result = await apiRequest('/subjects', { method: 'POST', body: JSON.stringify(subject) });
  return result.subject;
}

export async function updateSubject(id, subject) {
  const result = await apiRequest(`/subjects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(subject) });
  return result.subject;
}

export const deleteSubject = (id) => apiRequest(`/subjects/${encodeURIComponent(id)}`, { method: 'DELETE' });
