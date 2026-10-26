import { localRequest } from './localAttendanceRepository.js';

export const getLocalSetting = (key) => localRequest('settings.get', { key });
export const saveLocalSetting = (key, value) => localRequest('settings.save', { key, value });
export const deleteLocalSetting = (key) => localRequest('settings.delete', { key });
