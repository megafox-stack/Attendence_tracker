import { localRequest } from './localAttendanceRepository.js';

export async function getSubjects() { return (await localRequest('subject.list')).subjects || []; }
export async function createSubject(subject) { return (await localRequest('subject.create', subject)).subject; }
export async function updateSubject(id, subject) { return (await localRequest('subject.update', { id, ...subject })).subject; }
export const deleteSubject = (id) => localRequest('subject.delete', { id });
