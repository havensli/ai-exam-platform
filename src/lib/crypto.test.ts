import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { encryptToken, decryptToken } from './crypto';

const TEST_KEY = 'unit-test-passphrase-not-for-prod';
const REPO_ROOT = path.resolve(__dirname, '../../');
const PYTHON_BIN = path.join(REPO_ROOT, 'worker/.venv/bin/python');
const PY_CLI = path.join(REPO_ROOT, 'worker/tests/helpers/crypto_cli.py');

function runPython(action: 'encrypt' | 'decrypt', value: string, key = TEST_KEY): string {
  return execFileSync(PYTHON_BIN, [PY_CLI, action, value], {
    env: { ...process.env, TOKEN_ENCRYPTION_KEY: key },
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();
}

// Flips a single base64url character in the middle of the token, which is
// guaranteed to land inside the HMAC/ciphertext body (not the '=' padding).
function tamper(token: string): string {
  const i = Math.floor(token.length / 2);
  const ch = token[i];
  const replacement = ch === 'A' ? 'B' : 'A';
  return token.slice(0, i) + replacement + token.slice(i + 1);
}

describe('crypto.ts (Fernet-compatible token encryption)', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips with a passphrase-derived key', () => {
    const token = encryptToken('hello-world');
    expect(decryptToken(token)).toBe('hello-world');
  });

  it('round-trips with a proper 32-byte Fernet key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
    const token = encryptToken('another-secret');
    expect(decryptToken(token)).toBe('another-secret');
  });

  it('produces a different token each time (random IV)', () => {
    const a = encryptToken('same-plaintext');
    const b = encryptToken('same-plaintext');
    expect(a).not.toBe(b);
  });

  it('rejects a tampered token', () => {
    const token = encryptToken('payload');
    expect(() => decryptToken(tamper(token))).toThrow(/HMAC/);
  });

  it('rejects decryption with the wrong key', () => {
    const token = encryptToken('secret-for-key-a');
    process.env.TOKEN_ENCRYPTION_KEY = 'a-completely-different-passphrase';
    expect(() => decryptToken(token)).toThrow();
  });

  it('throws when TOKEN_ENCRYPTION_KEY is unset', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken('x')).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('rejects a truncated token', () => {
    const token = encryptToken('payload');
    expect(() => decryptToken(token.slice(0, 10))).toThrow();
  });

  describe('interop with worker/grading/crypto.py', () => {
    it('Python-encrypted token decrypts correctly here', () => {
      const token = runPython('encrypt', 'cross-lang-py-to-ts');
      expect(decryptToken(token)).toBe('cross-lang-py-to-ts');
    });

    it('token encrypted here decrypts correctly in Python', () => {
      const token = encryptToken('cross-lang-ts-to-py');
      expect(runPython('decrypt', token)).toBe('cross-lang-ts-to-py');
    });

    it('interoperates using a proper 32-byte Fernet key on both sides', () => {
      const key = randomBytes(32).toString('base64url');
      process.env.TOKEN_ENCRYPTION_KEY = key;
      const token = encryptToken('shared-fernet-key-payload');
      expect(runPython('decrypt', token, key)).toBe('shared-fernet-key-payload');
    });
  });
});
