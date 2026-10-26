import { getNativeNotificationPermission, localRequest, openNativeNotificationSettings, requestNativeNotificationPermission } from './localAttendanceRepository.js';

export const getLocalSetting = (key) => localRequest('settings.get', { key });
export const saveLocalSetting = (key, value) => localRequest('settings.save', { key, value });
export const deleteLocalSetting = (key) => localRequest('settings.delete', { key });

export const getNotificationSettings = () => localRequest('notifications.settings.get');
export const saveNotificationSettings = (settings) => localRequest('notifications.settings.save', settings);
export const getNotificationPermission = () => getNativeNotificationPermission();
export const requestNotificationPermission = () => requestNativeNotificationPermission();
export const openNotificationSettings = () => openNativeNotificationSettings();
