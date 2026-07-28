/**
 * url-hash.util unit spec — contract mục 3 (DRY: dùng chung SHA-256 cho
 * RawArticle + NewsArticle).
 *
 * Bao phủ:
 * - generateUrlHash trả đúng SHA-256 hex 64 chars, khớp crypto createHash.
 * - URL rỗng / whitespace-only → throw Error.
 * - Hai URL khác chuỗi → hash khác (tránh collision của MD5 cũ).
 * - Hai URL cùng chuỗi → hash bằng (deterministic).
 */
import * as crypto from 'crypto';
import { generateUrlHash } from './url-hash.util';

describe('url-hash.util (contract mục 3 — SHA-256 DRY)', () => {
  it('trả đúng SHA-256 hex 64 ký tự, khớp crypto trực tiếp', () => {
    const url = 'https://example.com/article/1';
    const hash = generateUrlHash(url);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(crypto.createHash('sha256').update(url).digest('hex'));
  });

  it('deterministic — cùng URL cho cùng hash', () => {
    const url = 'https://vnexpress.net/bai-viet-123';
    expect(generateUrlHash(url)).toBe(generateUrlHash(url));
  });

  it('URL khác chuỗi → hash khác (tránh collision MD5 cũ)', () => {
    const a = generateUrlHash('https://example.com/a');
    const b = generateUrlHash('https://example.com/b');
    expect(a).not.toBe(b);
  });

  it('URL giống nhau nhưng khác query → hash khác', () => {
    expect(generateUrlHash('https://x.com/p?id=1')).not.toBe(
      generateUrlHash('https://x.com/p?id=2'),
    );
  });

  it('URL rỗng → throw "URL không được rỗng..."', () => {
    expect(() => generateUrlHash('')).toThrow(
      'URL không được rỗng khi sinh urlHash',
    );
  });

  it('URL chỉ có whitespace → throw', () => {
    expect(() => generateUrlHash('   ')).toThrow(
      'URL không được rỗng khi sinh urlHash',
    );
  });

  it('URL null/undefined → throw (guard trước khi truy .trim())', () => {
    expect(() => generateUrlHash(null as unknown as string)).toThrow();
    expect(() => generateUrlHash(undefined as unknown as string)).toThrow();
  });

  it('URL chứa ký tự Unicode (Vietnamese) → SHA-256 ổn định (utf-8 bytes)', () => {
    const url = 'https://cafeland.vn/bài-viết-đà-nẵng';
    const hash = generateUrlHash(url);
    expect(hash).toBe(crypto.createHash('sha256').update(url).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
