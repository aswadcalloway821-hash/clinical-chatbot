import fs from 'fs';

const j = JSON.parse(fs.readFileSync('google-creds.json', 'utf8'));
const b64 = (j.private_key as string).replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
const der = Buffer.from(b64, 'base64');

function readLen(buf: Buffer, off: number): { len: number; next: number } {
  const first = buf[off];
  if ((first & 0x80) === 0) return { len: first, next: off + 1 };
  const n = first & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + buf[off + 1 + i];
  return { len, next: off + 1 + n };
}

// inner OCTET STRING starts at 22, header is 4 82 04 A4 -> content at 26
const innerStart = 26;
const innerLen = der.length - innerStart;
console.log('inner RSA content bytes available:', innerLen);

let off = innerStart;
const names = ['version', 'modulus', 'publicExponent', 'privateExponent', 'prime1', 'prime2', 'exponent1', 'exponent2', 'coefficient'];
let i = 0;
while (off < der.length) {
  const tag = der[off];
  const { len, next } = readLen(der, off + 1);
  const end = next + len;
  const name = names[i] || `extra_${i}`;
  const status = end <= der.length ? '' : ' <-- TRUNCATED';
  console.log(`${name}: tag=0x${tag.toString(16)} len=${len} bytes ${off}..${end}${status}`);
  if (end > der.length) break;
  off = end;
  i++;
}
console.log('components parsed:', i, 'of expected 9');
