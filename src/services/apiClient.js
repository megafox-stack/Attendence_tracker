const API_URL = import.meta.env.VITE_API_URL;
let sessionToken = null;

export class ApiUnavailableError extends Error {
  constructor(message = 'Backend unavailable. Connect the attendance service to load or save your data.') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function setSessionToken(token) {
  sessionToken = token || null;
  globalThis.dispatchEvent?.(new Event('attenda:session-change'));
}

export function hasSessionToken() {
  return Boolean(sessionToken);
}

export async function apiRequest(path, options = {}) {
  if (!API_URL) throw new ApiUnavailableError();
  let response;
  try {
    response = await fetch(`${API_URL.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiUnavailableError();
  }
  if (!response.ok) {
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    const detail = payload?.error;
    throw new ApiError(detail?.message || `The attendance service returned an error (${response.status}).`, response.status, detail?.code);
  }
  if (response.status === 204) return null;
  return response.json();
}
