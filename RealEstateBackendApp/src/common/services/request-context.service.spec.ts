/**
 * RequestContextService unit spec — contract mục 4 (Correlation ID qua ALS).
 *
 * Bao phủ:
 * - getRequestId() trong ALS context (được run bởi middleware) → trả đúng ID.
 * - getRequestId() ngoài HTTP context (cron/script) → trả 'unknown' (không throw).
 */
import { requestContextStorage } from './request-context.service';
import { RequestContextService } from './request-context.service';

describe('RequestContextService (contract mục 4)', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('ngoài ALS context → trả "unknown" (cron job, script, bootstrap)', () => {
    expect(service.getRequestId()).toBe('unknown');
  });

  it('trong ALS context → trả đúng requestId đã được run', () => {
    const result = requestContextStorage.run(
      { requestId: 'trace-id-xyz' },
      () => service.getRequestId(),
    );

    expect(result).toBe('trace-id-xyz');
  });

  it('không throw khi ALS store undefined (defensive ??)', () => {
    // Gọi trực tiếp ngoài context — getStore() trả undefined.
    expect(() => service.getRequestId()).not.toThrow();
    expect(service.getRequestId()).toBe('unknown');
  });

  it('hai ALS run lồng nhau (nested) → lấy ID của context gần nhất', () => {
    const outer = requestContextStorage.run({ requestId: 'outer' }, () => {
      const inner = requestContextStorage.run(
        { requestId: 'inner' },
        () => service.getRequestId(),
      );
      return { inner, outerSelf: service.getRequestId() };
    });

    expect(outer.inner).toBe('inner');
    expect(outer.outerSelf).toBe('outer');
  });
});
