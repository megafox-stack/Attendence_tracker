import { registerPlugin, Capacitor } from '@capacitor/core';

const LocalAttendance = registerPlugin('LocalAttendance');
async function nativeFileAction(method) {
  if (!Capacitor.isNativePlatform()) throw new Error('Backup files are available from the installed Android app.');
  try {
    const result = await LocalAttendance[method]();
    if (!result?.cancelled && method === 'importBackup') globalThis.dispatchEvent?.(new Event('attenda:session-change'));
    return result;
  } catch (error) { throw new Error(error?.message || 'The backup file operation failed.'); }
}
export const exportLocalBackup = () => nativeFileAction('exportBackup');
export const importLocalBackup = () => nativeFileAction('importBackup');
