import { ExternalLogSanitizerService } from './external-log-sanitizer.service';

/**
 * Unit test cho ExternalLogSanitizerService — deep-clone + mask bí mật + truncate.
 * Stateless service → dùng instance thật, không cần TestingModule.
 */
describe('ExternalLogSanitizerService', () => {
  let service: ExternalLogSanitizerService;

  beforeEach(() => {
    service = new ExternalLogSanitizerService();
  });

  describe('sanitizeHeaders', () => {
    it('mask authorization/x-api-key/cookie case-insensitive', () => {
      const headers = {
        Authorization: 'Bearer abc',
        'X-API-Key': 'sk-123',
        cookie: 'session=abc',
        'User-Agent': 'Mozilla/5.0',
      };

      const result = service.sanitizeHeaders(headers);

      expect(result.Authorization).toBe('***REDACTED***');
      expect(result['X-API-Key']).toBe('***REDACTED***');
      expect(result.cookie).toBe('***REDACTED***');
      expect(result['User-Agent']).toBe('Mozilla/5.0');
    });

    it('mask toàn bộ header nhạy cảm (set-cookie, x-auth-token, secret...)', () => {
      const result = service.sanitizeHeaders({
        'Set-Cookie': 'a=1',
        'X-Auth-Token': 't',
        'X-CSRF-Token': 'csrf',
        Session: 'sess',
        'X-Forwarded-For': '1.2.3.4',
      });

      expect(result['Set-Cookie']).toBe('***REDACTED***');
      expect(result['X-Auth-Token']).toBe('***REDACTED***');
      expect(result['X-CSRF-Token']).toBe('***REDACTED***');
      expect(result.Session).toBe('***REDACTED***');
      expect(result['X-Forwarded-For']).toBe('1.2.3.4');
    });

    it('không mutate object gốc', () => {
      const headers = { Authorization: 'Bearer abc' };

      service.sanitizeHeaders(headers);

      expect(headers.Authorization).toBe('Bearer abc');
    });
  });

  describe('sanitizeValue', () => {
    it('deep-clone + mask key nhạy cảm ở mọi độ sâu', () => {
      const input = {
        apiKey: 'secret-1',
        nested: { token: 'secret-2', ok: 'value' },
        list: [{ password: 'p' }],
      };

      const result = service.sanitizeValue(input);

      expect(result).toEqual({
        apiKey: '***REDACTED***',
        nested: { token: '***REDACTED***', ok: 'value' },
        list: [{ password: '***REDACTED***' }],
      });
    });

    it('trả object mới, KHÔNG mutate object gốc', () => {
      const input = { apiKey: 'secret', nested: { token: 't' } };

      const result = service.sanitizeValue(input);

      expect(result).not.toBe(input);
      expect(result.nested).not.toBe(input.nested);
      expect(input.apiKey).toBe('secret');
      expect(input.nested.token).toBe('t');
    });

    it('giữ nguyên primitive và null', () => {
      expect(service.sanitizeValue('text')).toBe('text');
      expect(service.sanitizeValue(42)).toBe(42);
      expect(service.sanitizeValue(null)).toBe(null);
      expect(service.sanitizeValue(undefined)).toBe(undefined);
    });
  });

  describe('sanitizeUrl', () => {
    it('mask query param nhạy cảm (api_key, token, key, signature)', () => {
      const result = service.sanitizeUrl(
        'https://vnexpress.net/rss?api_key=secret&page=2&token=abc&sig=x',
      );

      expect(result).toBe(
        'https://vnexpress.net/rss?api_key=***REDACTED***&page=2&token=***REDACTED***&sig=***REDACTED***',
      );
    });

    it('mask userinfo user:pass@host', () => {
      const result = service.sanitizeUrl('https://user:pass@example.com/data');

      expect(result).toContain('***REDACTED***:***REDACTED***@example.com');
      expect(result).not.toContain('user:pass');
    });

    it('URL không parse được → giữ nguyên raw', () => {
      expect(service.sanitizeUrl('not a url')).toBe('not a url');
    });
  });

  describe('truncateString', () => {
    it('không cắt khi không vượt maxBytes', () => {
      expect(service.truncateString('short', 100)).toBe('short');
    });

    it('cắt + hậu tố ...[TRUNCATED] khi vượt maxBytes', () => {
      const long = 'x'.repeat(100);

      expect(service.truncateString(long, 10)).toBe('xxxxxxxxxx...[TRUNCATED]');
    });
  });

  describe('truncateBody', () => {
    it('string → truncateString', () => {
      const result = service.truncateBody('y'.repeat(100), 10);

      expect(result).toBe('yyyyyyyyyy...[TRUNCATED]');
    });

    it('object → JSON.stringify rồi cắt, lưu dạng string khi bị cắt', () => {
      const body = { data: 'z'.repeat(100) };
      const result = service.truncateBody(body, 10);

      expect(typeof result).toBe('string');
      expect(result.endsWith('...[TRUNCATED]')).toBe(true);
    });

    it('object nhỏ → giữ nguyên object gốc (không cắt)', () => {
      const body = { ok: true };
      const result = service.truncateBody(body, 1000);

      expect(result).toBe(body);
    });

    it('null/undefined/primitive → giữ nguyên', () => {
      expect(service.truncateBody(null, 10)).toBe(null);
      expect(service.truncateBody(undefined, 10)).toBe(undefined);
      expect(service.truncateBody(42, 10)).toBe(42);
    });
  });
});
