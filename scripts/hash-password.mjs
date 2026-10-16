// Usage: node scripts/hash-password.mjs "your long password"
// Prints ADMIN_PASSWORD_HASH and a fresh SESSION_SECRET to paste into Netlify.
import crypto from 'node:crypto';
import { hashPassword } from '../netlify/lib/core.mjs';

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('Give a password of at least 10 characters:\n  node scripts/hash-password.mjs "your long password"');
  process.exit(1);
}
console.log('\nADMIN_PASSWORD_HASH=' + hashPassword(pw));
console.log('SESSION_SECRET=' + crypto.randomBytes(32).toString('hex') + '\n');
