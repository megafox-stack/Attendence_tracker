import { localRequest } from './localAttendanceRepository.js';

export const getSchedulerStatus = () => localRequest('scheduler.status');
export const updateScheduler = (settings) => localRequest('scheduler.update', settings);
