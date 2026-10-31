import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const KEY_BYTES = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, cost, blockSize, parallelization, saltPart, keyPart, extra] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || extra !== undefined) return false;
  const params = [cost, blockSize, parallelization].map(Number);
  if (!params.every(Number.isSafeInteger) || params[0] < 16_384 || params[0] > 262_144 || params[1] < 1 || params[1] > 16 || params[2] < 1 || params[2] > 4) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltPart, 'base64url');
    expected = Buffer.from(keyPart, 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_BYTES) return false;

  const actual = await scrypt(password, salt, expected.length, {
    N: params[0],
    r: params[1],
    p: params[2],
    maxmem: MAX_MEMORY,
  });
  return timingSafeEqual(Buffer.from(actual), expected);
}
