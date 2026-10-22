import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const value = process.env.PLATFORM_CREDENTIAL_KEY;
  const bytes = value
    ? Buffer.from(value, 'base64')
    : process.env.NODE_ENV === 'test'
      ? Buffer.alloc(32, 7)
      : Buffer.alloc(0);
  if (bytes.length !== 32)
    throw new Error('Configure PLATFORM_CREDENTIAL_KEY with a base64 encoded 32-byte key.');
  return bytes;
}
export const credentialTransformer = {
  to(value: string | null): string | null {
    if (!value) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join(':');
  },
  from(value: string | null): string | null {
    if (!value) return null;
    // Existing connections are upgraded on their next credential save.
    if (!value.startsWith('v1:')) return value;
    const [, iv, tag, data] = value.split(':');
    const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv!, 'base64'));
    cipher.setAuthTag(Buffer.from(tag!, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(data!, 'base64')), cipher.final()]).toString(
      'utf8',
    );
  },
};
