import fs from 'fs';
import crypto from 'crypto';

const j = JSON.parse(fs.readFileSync('google-creds.json', 'utf8'));
const key = j.private_key;
console.log('header ok:', key.startsWith('-----BEGIN PRIVATE KEY-----'));
console.log('footer ok:', key.trimEnd().endsWith('-----END PRIVATE KEY-----'));

// Check first few lines exactly
const lines = key.split('\n');
console.log('lines count:', lines.length);
console.log('line1:', JSON.stringify(lines[0]));
console.log('line2 len:', lines[1]?.length, 'prefix:', lines[1]?.slice(0, 20));

try {
  const k = crypto.createPrivateKey({ key, format: 'pem', type: 'pkcs8' });
  console.log('parse OK, type:', k.asymmetricKeyType, 'size:', k.asymmetricKeyDetails?.modulusLength);
} catch (e) {
  console.log('NODE PARSE FAILED:', e.message);
  // try treating as pkcs1
  try {
    const k1 = crypto.createPrivateKey({ key, format: 'pem', type: 'pkcs1' });
    console.log('pkcs1 parse OK');
  } catch (e2) {
    console.log('pkcs1 also failed:', e2.message);
  }
}
