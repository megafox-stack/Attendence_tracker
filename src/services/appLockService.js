import { Capacitor } from '@capacitor/core';
import { authenticateNativeAppLock, getNativeAppLockState, setNativeAppLockPin, updateNativeAppLock, verifyNativeAppLockPin } from './localAttendanceRepository.js';

export function isNativeAppLockAvailable() { return Capacitor.isNativePlatform(); }
export const getAppLockState = getNativeAppLockState;
export const updateAppLock = updateNativeAppLock;
export const setAppLockPin = setNativeAppLockPin;
export const verifyAppLockPin = verifyNativeAppLockPin;
export const authenticateAppLock = authenticateNativeAppLock;
