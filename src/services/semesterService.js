import { localRequest } from './localAttendanceRepository.js';

export async function getCurrentSemester() { return (await localRequest('semester.getCurrent')).semester || null; }
export async function saveCurrentSemester(semester) { return (await localRequest('semester.save', semester)).semester; }
export async function getSemesters() { return localRequest('semester.list'); }
export async function createSemester(semester) { return (await localRequest('semester.create', semester)).semester; }
export async function selectSemester(id) { return (await localRequest('semester.select', { id })).semester; }
export async function deleteSemester(id) { return localRequest('semester.delete', { id }); }
