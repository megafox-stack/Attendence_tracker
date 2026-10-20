import { apiRequest, setSessionToken } from './apiClient.js';

export async function checkApiHealth() {
  return apiRequest('/health/ready');
}

export async function registerAccount({ email, password, displayName, timeZone }) {
  const result = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName, timeZone }),
  });
  setSessionToken(result.session.token);
  return result.user;
}

export async function loginAccount({ email, password }) {
  const result = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSessionToken(result.session.token);
  return result.user;
}

export async function logoutAccount() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } finally {
    setSessionToken(null);
  }
}
