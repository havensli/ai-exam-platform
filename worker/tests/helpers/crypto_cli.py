"""CLI bridge used by cross-language tests (src/lib/crypto.test.ts) to
exercise worker/grading/crypto.py from a separate process.
Run with: python crypto_cli.py <encrypt|decrypt> <value>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # worker/

from grading.crypto import decrypt_token, encrypt_token  # noqa: E402

if __name__ == "__main__":
    action, value = sys.argv[1], sys.argv[2]
    if action == "encrypt":
        print(encrypt_token(value))
    elif action == "decrypt":
        print(decrypt_token(value))
    else:
        raise SystemExit(f"Unknown action: {action}")
