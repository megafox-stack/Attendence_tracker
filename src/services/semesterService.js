import { apiRequest } from './apiClient.js';

export async function getCurrentSemester() {
  const result = await apiRequest('/semesters/current');
  return result.semester;
}

export async function saveCurrentSemester(semester) {
  const result = await apiRequest('/semesters/current', {
    method: 'PUT',
    body: JSON.stringify(semester),
  });
  return result.semester;
}
