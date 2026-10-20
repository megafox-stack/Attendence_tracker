import { apiRequest } from './apiClient.js';
export const getSchedulerStatus = () => apiRequest('/scheduler/status');
export const updateScheduler = (settings) => apiRequest('/scheduler/settings', { method: 'PUT', body: JSON.stringify(settings) });
