import { registerPlugin, Capacitor } from '@capacitor/core';

const LocalAttendance = registerPlugin('LocalAttendance');
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') globalThis.dispatchEvent?.(new Event('attenda:session-change'));
  });
}
const writes = new Set([
  'semester.save', 'semester.create', 'semester.select', 'semester.delete', 'subject.create', 'subject.update', 'subject.delete',
  'timetable.create', 'timetable.update', 'timetable.active', 'timetable.delete',
  'timetable.import', 'timetable.clear',
  'holiday.create', 'holiday.delete', 'attendance.generate', 'attendance.update', 'attendance.delete',
  'attendance.bulk', 'attendance.submit', 'attendance.reset', 'scheduler.update', 'settings.save', 'settings.delete', 'notifications.settings.save', 'backup.restore',
  'manual.commit',
]);

export async function localRequest(action, payload = {}) {
  if (!Capacitor.isNativePlatform()) {
    const error = new Error('Local Room storage is available in the installed Android app.');
    error.code = 'native_storage_unavailable';
    throw error;
  }
  try {
    const result = await LocalAttendance.request({ action, payload });
    if (writes.has(action)) globalThis.dispatchEvent?.(new Event('attenda:session-change'));
    return result;
  } catch (error) {
    const wrapped = new Error(error?.message || 'Could not access local attendance data.');
    wrapped.code = error?.code || 'local_database_error';
    throw wrapped;
  }
}

export async function pickTimetableImage() {
  if (!Capacitor.isNativePlatform()) {
    const error = new Error('Timetable image import is available in the installed Android app.');
    error.code = 'native_image_picker_unavailable';
    throw error;
  }
  globalThis.dispatchEvent?.(new Event('attenda:file-chooser-open'));
  try { return await LocalAttendance.pickTimetableImage(); }
  catch (error) { throw new Error(error?.message || 'Could not read the timetable image.'); }
  finally { globalThis.dispatchEvent?.(new Event('attenda:file-chooser-close')); }
}

export async function getNativeNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return { granted: false };
  return LocalAttendance.getNotificationPermission();
}

export async function requestNativeNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return { granted: false };
  return LocalAttendance.requestNotificationPermission();
}

export async function openNativeNotificationSettings() {
  if (!Capacitor.isNativePlatform()) throw new Error('Notification settings are available in the installed Android app.');
  return LocalAttendance.openNotificationSettings();
}

export async function getNativeAppLockState() {
  if (!Capacitor.isNativePlatform()) return { supported: false, enabled: false, biometricEnabled: false, pinEnabled: false, biometricAvailable: false, hasPin: false };
  return LocalAttendance.getAppLockState();
}
export async function updateNativeAppLock(settings) {
  if (!Capacitor.isNativePlatform()) throw new Error('App Lock is available in the installed Android app.');
  return LocalAttendance.updateAppLock(settings);
}
export async function setNativeAppLockPin(pin, confirmation) {
  if (!Capacitor.isNativePlatform()) throw new Error('PIN setup is available in the installed Android app.');
  return LocalAttendance.setAppLockPin({ pin, confirmation });
}
export async function verifyNativeAppLockPin(pin) {
  if (!Capacitor.isNativePlatform()) throw new Error('PIN unlock is available in the installed Android app.');
  return LocalAttendance.verifyAppLockPin({ pin });
}
export async function authenticateNativeAppLock() {
  if (!Capacitor.isNativePlatform()) throw new Error('Biometric unlock is available in the installed Android app.');
  return LocalAttendance.authenticateAppLock();
}

export function hasLocalDatabase() { return Capacitor.isNativePlatform(); }
