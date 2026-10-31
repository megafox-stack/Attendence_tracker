import { Capacitor } from '@capacitor/core';

/** Compatibility helpers for the existing pages; native storage is not available in a browser. */
export class ApiUnavailableError extends Error {
  constructor(message = 'Local attendance storage is unavailable in this environment.') { super(message); this.name = 'ApiUnavailableError'; }
}
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
export function setSessionToken() {}
export function hasSessionToken() { return Capacitor.isNativePlatform(); }
export async function apiRequest() {
  throw new ApiUnavailableError('This app now stores attendance on the Android device and does not connect to a backend.');
}
