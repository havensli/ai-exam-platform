import os
import subprocess
from pathlib import Path

import pytest
from cryptography.fernet import Fernet, InvalidToken

from grading.crypto import decrypt_token, encrypt_token

TEST_KEY = "unit-test-passphrase-not-for-prod"
REPO_ROOT = Path(__file__).resolve().parents[2]
TSX_BIN = REPO_ROOT / "node_modules" / ".bin" / "tsx"
TS_CLI = REPO_ROOT / "scripts" / "crypto_cli.ts"


@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", TEST_KEY)


def test_round_trip_passphrase_key():
    token = encrypt_token("hello-world")
    assert decrypt_token(token) == "hello-world"


def test_round_trip_proper_fernet_key(monkeypatch):
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    token = encrypt_token("another-secret")
    assert decrypt_token(token) == "another-secret"


def test_produces_different_token_each_time():
    a = encrypt_token("same-plaintext")
    b = encrypt_token("same-plaintext")
    assert a != b


def test_rejects_tampered_token():
    token = encrypt_token("payload")
    mid = len(token) // 2
    ch = token[mid]
    replacement = "B" if ch == "A" else "A"
    tampered = token[:mid] + replacement + token[mid + 1:]
    with pytest.raises(InvalidToken):
        decrypt_token(tampered)


def test_rejects_wrong_key(monkeypatch):
    token = encrypt_token("secret-for-key-a")
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", "a-completely-different-passphrase")
    with pytest.raises(InvalidToken):
        decrypt_token(token)


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("TOKEN_ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="TOKEN_ENCRYPTION_KEY"):
        encrypt_token("x")


def _run_ts_cli(action: str, value: str, key: str = TEST_KEY) -> str:
    result = subprocess.run(
        [str(TSX_BIN), str(TS_CLI), action, value],
        cwd=REPO_ROOT,
        env={**os.environ, "TOKEN_ENCRYPTION_KEY": key},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


@pytest.mark.skipif(not TSX_BIN.exists(), reason="tsx not installed (run npm install)")
class TestInteropWithTypeScript:
    def test_python_encrypt_ts_decrypt(self):
        token = encrypt_token("cross-lang-py-to-ts")
        assert _run_ts_cli("decrypt", token) == "cross-lang-py-to-ts"

    def test_ts_encrypt_python_decrypt(self):
        token = _run_ts_cli("encrypt", "cross-lang-ts-to-py")
        assert decrypt_token(token) == "cross-lang-ts-to-py"

    def test_shared_proper_fernet_key(self, monkeypatch):
        key = Fernet.generate_key().decode()
        monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", key)
        token = encrypt_token("shared-fernet-key-payload")
        assert _run_ts_cli("decrypt", token, key=key) == "shared-fernet-key-payload"
