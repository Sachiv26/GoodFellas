import { describe, expect, it } from '@jest/globals';
import {
  detectFileSignature,
  signatureExtension,
  signatureMatchesMime,
} from '@/lib/upload/file-signature';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(64)]);
const html = Buffer.from('<html><script>alert(1)</script></html>');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('upload content verification', () => {
  it('detects the real container format from the leading bytes', () => {
    expect(detectFileSignature(jpeg)).toBe('jpeg');
    expect(detectFileSignature(png)).toBe('png');
    expect(detectFileSignature(pdf)).toBe('pdf');
  });

  it('returns null for content that is not an allowed upload format', () => {
    expect(detectFileSignature(html)).toBeNull();
    expect(detectFileSignature(svg)).toBeNull();
    expect(detectFileSignature(Buffer.alloc(4))).toBeNull();
    expect(detectFileSignature(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('accepts a file whose bytes match its declared MIME type', () => {
    expect(signatureMatchesMime(jpeg, 'image/jpeg')).toBe(true);
    expect(signatureMatchesMime(jpeg, 'image/jpg')).toBe(true);
    expect(signatureMatchesMime(png, 'image/png')).toBe(true);
    expect(signatureMatchesMime(pdf, 'application/pdf')).toBe(true);
  });

  it('rejects a declared type that the bytes contradict (spoofed upload)', () => {
    // The classic attack: JPEG extension + declared image/jpeg, real payload HTML.
    expect(signatureMatchesMime(html, 'image/jpeg')).toBe(false);
    expect(signatureMatchesMime(svg, 'image/png')).toBe(false);
    // And the reverse: a real PDF that claims to be an image.
    expect(signatureMatchesMime(pdf, 'image/jpeg')).toBe(false);
  });

  it('never trusts an empty or unknown mime type', () => {
    expect(signatureMatchesMime(jpeg, '')).toBe(false);
    expect(signatureMatchesMime(jpeg, 'application/octet-stream')).toBe(false);
    expect(signatureMatchesMime(jpeg, 'IMAGE/JPEG')).toBe(true); // case-insensitive
  });

  it('derives a storage-key extension from the verified signature', () => {
    expect(signatureExtension('jpeg')).toBe('jpg');
    expect(signatureExtension('png')).toBe('png');
    expect(signatureExtension('pdf')).toBe('pdf');
  });
});
