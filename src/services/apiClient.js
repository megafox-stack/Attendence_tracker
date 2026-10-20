const API_URL = import.meta.env.VITE_API_URL;

export class ApiUnavailableError extends Error {
  constructor(message = 'Backend unavailable. Connect the attendance service to load or save your data.') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export async function apiRequest(path, options = {}) {
  if (!API_URL) throw new ApiUnavailableError();
  let response;
  try {
    response = await fetch(`${API_URL.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new ApiUnavailableError();
  }
  if (!response.ok) throw new ApiUnavailableError(`The attendance service returned an error (${response.status}).`);
  if (response.status === 204) return null;
  return response.json();
}
