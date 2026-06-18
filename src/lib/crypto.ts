import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Fernet-compatible symmetric encryption (https://github.com/fernet/spec),
 * mirroring worker/grading/crypto.py so git tokens encrypted here can be
 * decrypted by the Python worker, and vice versa, from the same
 * TOKEN_ENCRYPTION_KEY value.
 */

const FERNET_VERSION = 0x80;

function deriveRawKey(raw: string): Buffer {
  // If `raw` is itself a valid 32-byte url-safe base64 key (e.g. Fernet.generate_key()
  // output), use it directly. Otherwise derive a deterministic 32-byte key via SHA-256 —
  // this matches worker/grading/crypto.py's _derive_key() exactly.
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) {
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    try {
      const decoded = Buffer.from(padded, 'base64url');
      if (decoded.length === 32) return decoded;
    } catch {
      // fall through to hash-based derivation
    }
  }
  return createHash('sha256').update(Buffer.from(raw, 'utf8')).digest();
}

function getKeys(): { signingKey: Buffer; encryptionKey: Buffer } {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY environment variable is not set');
  const rawKey = deriveRawKey(key);
  return { signingKey: rawKey.subarray(0, 16), encryptionKey: rawKey.subarray(16, 32) };
}

function addBase64Padding(b64url: string): string {
  return b64url + '='.repeat((4 - (b64url.length % 4)) % 4);
}

export function encryptToken(plaintext: string): string {
  const { signingKey, encryptionKey } = getKeys();

  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);

  const version = Buffer.from([FERNET_VERSION]);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));

  const payload = Buffer.concat([version, timestamp, iv, ciphertext]);
  const hmac = createHmac('sha256', signingKey).update(payload).digest();

  return addBase64Padding(Buffer.concat([payload, hmac]).toString('base64url'));
}

export function decryptToken(token: string): string {
  const { signingKey, encryptionKey } = getKeys();

  const raw = Buffer.from(token, 'base64url');
  if (raw.length < 1 + 8 + 16 + 32) throw new Error('Invalid Fernet token: too short');

  const payload = raw.subarray(0, raw.length - 32);
  const hmac = raw.subarray(raw.length - 32);

  const expectedHmac = createHmac('sha256', signingKey).update(payload).digest();
  if (hmac.length !== expectedHmac.length || !timingSafeEqual(hmac, expectedHmac)) {
    throw new Error('Invalid Fernet token: HMAC verification failed');
  }

  const version = payload[0];
  if (version !== FERNET_VERSION) throw new Error(`Invalid Fernet token: unsupported version ${version}`);

  const iv = payload.subarray(9, 25);
  const ciphertext = payload.subarray(25);

  const decipher = createDecipheriv('aes-128-cbc', encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
