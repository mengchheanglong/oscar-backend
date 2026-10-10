import { Readable } from 'node:stream';
import { resumeHash } from '../../src/modules/local-folders/resume-hash';
describe('Streaming browser-compatible resume fingerprints', () => {
  it('matches independent empty and abc test vectors', async () => {
    expect(await resumeHash(Readable.from([]))).toBe(
      'sha256-blocks-v1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await resumeHash(Readable.from([Buffer.from('a'), Buffer.from('bc')]))).toBe(
      'sha256-blocks-v1:4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358',
    );
  });
  it('keeps block boundaries independent of stream chunk boundaries', async () => {
    const text = Buffer.alloc(8 * 1024 * 1024 + 1, 65);
    const expected =
      'sha256-blocks-v1:699966871277d908de9528d4cfee1234b388515c8d6cfb81c1b07fc5ab74ba6c';
    expect(await resumeHash(Readable.from([text]))).toBe(expected);
    expect(
      await resumeHash(Readable.from([text.subarray(0, 7000000), text.subarray(7000000)])),
    ).toBe(expected);
  });
});
