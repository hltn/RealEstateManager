import { formatVnShortDateTime } from './timezone.util';

/** T-35: nhãn giờ hẹn của mẫu push `APPOINTMENT_DUE` là `HH:mm dd/MM` theo giờ Việt Nam. */
describe('formatVnShortDateTime', () => {
  const ORIGINAL_ENV = process.env.APP_TIMEZONE_OFFSET_HOURS;
  beforeEach(() => {
    delete process.env.APP_TIMEZONE_OFFSET_HOURS;
  });
  afterAll(() => {
    if (ORIGINAL_ENV === undefined)
      delete process.env.APP_TIMEZONE_OFFSET_HOURS;
    else process.env.APP_TIMEZONE_OFFSET_HOURS = ORIGINAL_ENV;
  });

  it('quy đổi UTC sang giờ VN (+7) và không có năm', () => {
    expect(formatVnShortDateTime(new Date('2026-11-05T03:05:00.000Z'))).toBe(
      '10:05 05/11',
    );
  });

  it('qua nửa đêm giờ VN thì sang ngày hôm sau (17:30 UTC ngày 31/12 là 00:30 ngày 01/01)', () => {
    expect(formatVnShortDateTime(new Date('2026-12-31T17:30:00.000Z'))).toBe(
      '00:30 01/01',
    );
  });

  it('đúng 16:59 UTC vẫn là 23:59 cùng ngày VN', () => {
    expect(formatVnShortDateTime(new Date('2026-11-05T16:59:00.000Z'))).toBe(
      '23:59 05/11',
    );
  });
});
