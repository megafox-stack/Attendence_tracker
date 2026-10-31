import { createHash, randomBytes } from 'node:crypto';

export function createSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: createHash('sha256').update(token, 'ascii').digest() };
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token, 'ascii').digest();
}

export function getSessionExpiry(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
