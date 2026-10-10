import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
export const RESUME_BLOCK_BYTES = 8 * 1024 * 1024;
// SHA-256 of concatenated SHA-256 block digests; bounded memory on both browser and server.
export async function resumeHash(stream: Readable): Promise<string> {
  const outer = createHash('sha256');
  let block = createHash('sha256');
  let filled = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    let offset = 0;
    while (offset < buffer.length) {
      const count = Math.min(buffer.length - offset, RESUME_BLOCK_BYTES - filled);
      block.update(buffer.subarray(offset, offset + count));
      filled += count;
      offset += count;
      if (filled === RESUME_BLOCK_BYTES) {
        outer.update(block.digest());
        block = createHash('sha256');
        filled = 0;
      }
    }
  }
  if (filled) outer.update(block.digest());
  return `sha256-blocks-v1:${outer.digest('hex')}`;
}
