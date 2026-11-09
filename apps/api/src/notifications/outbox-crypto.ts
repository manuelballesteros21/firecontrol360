import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const value = process.env.OUTBOX_ENCRYPTION_KEY;
  if (!value) throw new Error('OUTBOX_ENCRYPTION_KEY is required');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error('OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return decoded;
}

export function encryptOutboxPayload(payload: unknown): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptOutboxPayload(payload: Buffer): unknown {
  if (!Buffer.isBuffer(payload) || payload.length < 30 || payload[0] !== 1) {
    throw new Error('Unsupported or malformed outbox payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(1, 13));
  decipher.setAuthTag(payload.subarray(13, 29));
  const plaintext = Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
