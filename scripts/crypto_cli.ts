// CLI bridge used by cross-language tests (worker/tests/test_crypto.py) to
// exercise src/lib/crypto.ts from a separate process without importing
// Next.js build machinery. Run with: tsx scripts/crypto_cli.ts <encrypt|decrypt> <value>
import { encryptToken, decryptToken } from '../src/lib/crypto';

const [action, value] = process.argv.slice(2);

if (action === 'encrypt' && value !== undefined) {
  process.stdout.write(encryptToken(value));
} else if (action === 'decrypt' && value !== undefined) {
  process.stdout.write(decryptToken(value));
} else {
  console.error('Usage: crypto_cli.ts <encrypt|decrypt> <value>');
  process.exit(1);
}
