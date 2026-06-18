"""
Symmetric encryption for per-submission git tokens, shared by the worker and
(via a compatible Node.js implementation) the Next.js side.

Uses Fernet (AES-128-CBC + HMAC-SHA256, see https://github.com/fernet/spec).
Key is a url-safe base64-encoded 32-byte key, read from TOKEN_ENCRYPTION_KEY.
Generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet


def _derive_key(raw: str) -> bytes:
    """
    Normalize TOKEN_ENCRYPTION_KEY into a valid Fernet key (32 url-safe
    base64-encoded bytes).

    Accepts either a proper `Fernet.generate_key()` output, or an arbitrary
    passphrase — the latter is deterministically hashed (SHA-256) into a
    32-byte key. The Node.js side (src/lib/crypto.ts) mirrors this exact
    derivation so both sides stay interoperable from the same env var value.
    """
    raw_bytes = raw.encode()
    try:
        padded = raw_bytes + b"=" * (-len(raw_bytes) % 4)
        decoded = base64.urlsafe_b64decode(padded)
        if len(decoded) == 32:
            return base64.urlsafe_b64encode(decoded)
    except Exception:
        pass
    return base64.urlsafe_b64encode(hashlib.sha256(raw_bytes).digest())


def _get_fernet() -> Fernet:
    key = os.environ.get("TOKEN_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY environment variable is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(_derive_key(key))


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext token using Fernet symmetric encryption."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    """Decrypt a Fernet-encrypted token."""
    return _get_fernet().decrypt(encrypted.encode()).decode()
