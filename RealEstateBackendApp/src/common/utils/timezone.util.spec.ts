/**
 * timezone.util unit spec — contract fix bug lọc bài viết theo ngày giờ Việt Nam.
 *
 * Bao phủ:
 * - getTimezoneOffsetHours(): fallback 7 khi thiếu APP_TIMEZONE_OFFSET_HOURS,
 *   fallback 7 khi giá trị không parse được (NaN), đọc đúng giá trị hợp lệ.
 * - startOfDayUtc / endOfDayUtc: quy đổi đúng mốc UTC từ ngày giờ VN (offset +7).
 * - Case biên: bài đăng 00:00-06:59 sáng giờ VN phải nằm TRONG khoảng
 *   [startOfDayUtc, endOfDayUtc] của đúng ngày đó (không bị lọt sang ngày hôm trước).
 */
import {
  getTimezoneOffsetHours,
  startOfDayUtc,
  endOfDayUtc,
  startOfDayUtcDaysAgo,
} from './timezone.util';

describe('timezone.util (fix bug lọc bài viết theo ngày giờ Việt Nam)', () => {
  const ORIGINAL_ENV = process.env.APP_TIMEZONE_OFFSET_HOURS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.APP_TIMEZONE_OFFSET_HOURS;
    } else {
      process.env.APP_TIMEZONE_OFFSET_HOURS = ORIGINAL_ENV;
    }
  });

  describe('getTimezoneOffsetHours', () => {
    it('thiếu env → fallback 7 (giờ Việt Nam mặc định)', () => {
      delete process.env.APP_TIMEZONE_OFFSET_HOURS;
      expect(getTimezoneOffsetHours()).toBe(7);
    });

    it('env parse ra NaN (chuỗi rỗng/không hợp lệ) → fallback 7', () => {
      process.env.APP_TIMEZONE_OFFSET_HOURS = 'abc';
      expect(getTimezoneOffsetHours()).toBe(7);
    });

    it('env hợp lệ → đọc đúng giá trị cấu hình', () => {
      process.env.APP_TIMEZONE_OFFSET_HOURS = '8';
      expect(getTimezoneOffsetHours()).toBe(8);
    });

    it('env = "0" → trả 0 (không bị coi là falsy rồi fallback nhầm)', () => {
      process.env.APP_TIMEZONE_OFFSET_HOURS = '0';
      expect(getTimezoneOffsetHours()).toBe(0);
    });
  });

  describe('startOfDayUtc / endOfDayUtc (offset mặc định +7)', () => {
    beforeEach(() => {
      delete process.env.APP_TIMEZONE_OFFSET_HOURS;
    });

    it('startOfDayUtc("2026-08-05") => 2026-08-04T17:00:00.000Z', () => {
      expect(startOfDayUtc('2026-08-05').toISOString()).toBe(
        '2026-08-04T17:00:00.000Z',
      );
    });

    it('endOfDayUtc("2026-08-05") => 2026-08-05T16:59:59.999Z', () => {
      expect(endOfDayUtc('2026-08-05').toISOString()).toBe(
        '2026-08-05T16:59:59.999Z',
      );
    });

    it('tôn trọng offset tùy chỉnh (VD +8) thay vì hardcode 7', () => {
      process.env.APP_TIMEZONE_OFFSET_HOURS = '8';
      expect(startOfDayUtc('2026-08-05').toISOString()).toBe(
        '2026-08-04T16:00:00.000Z',
      );
      expect(endOfDayUtc('2026-08-05').toISOString()).toBe(
        '2026-08-05T15:59:59.999Z',
      );
    });

    it('case biên: bài đăng 06:54:02 sáng giờ VN ngày 05/08 phải nằm TRONG khoảng lọc ngày 05/08', () => {
      // 06:54:02 sáng giờ VN 05/08/2026 = 23:54:02 UTC ngày 04/08/2026 (dữ liệu thật RSS Dân Trí).
      const articlePublishedAtUtc = new Date('2026-08-04T23:54:02.000Z');
      const start = startOfDayUtc('2026-08-05');
      const end = endOfDayUtc('2026-08-05');

      expect(articlePublishedAtUtc >= start).toBe(true);
      expect(articlePublishedAtUtc <= end).toBe(true);
    });

    it('case biên: bài đăng 23:59:59 giờ VN ngày 04/08 (= 16:59:59 UTC) KHÔNG nằm trong khoảng lọc ngày 05/08', () => {
      const articlePublishedAtUtc = new Date('2026-08-04T16:59:59.000Z');
      const start = startOfDayUtc('2026-08-05');

      expect(articlePublishedAtUtc < start).toBe(true);
    });
  });

  describe('startOfDayUtcDaysAgo (offset mặc định +7, "hôm nay" pin bằng fake timers)', () => {
    beforeEach(() => {
      delete process.env.APP_TIMEZONE_OFFSET_HOURS;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /**
     * Mỗi case: pin "bây giờ" (system time) vào 1 mốc UTC, rồi assert
     * startOfDayUtcDaysAgo(days) cho days=1/2/7. Assertion dùng literal ISO
     * hardcode (tính tay bằng offset +7) — KHÔNG gọi lại hàm đang test.
     */
    it.each([
      [
        '2026-08-04T17:30:00Z (=00:30 giờ VN 05/08 — vừa qua nửa đêm VN)',
        '2026-08-04T17:30:00Z',
        {
          1: '2026-08-04T17:00:00.000Z',
          2: '2026-08-03T17:00:00.000Z',
          7: '2026-07-29T17:00:00.000Z',
        },
      ],
      [
        '2026-08-04T16:59:59Z (=23:59:59 giờ VN 04/08 — sắp qua nửa đêm VN)',
        '2026-08-04T16:59:59Z',
        {
          1: '2026-08-03T17:00:00.000Z',
          2: '2026-08-02T17:00:00.000Z',
          7: '2026-07-28T17:00:00.000Z',
        },
      ],
      [
        '2025-12-31T18:00:00Z (=01:00 giờ VN 01/01/2026 — rollover năm)',
        '2025-12-31T18:00:00Z',
        {
          1: '2025-12-31T17:00:00.000Z',
          2: '2025-12-30T17:00:00.000Z',
          7: '2025-12-25T17:00:00.000Z',
        },
      ],
      [
        '2028-03-01T18:00:00Z (=01:00 giờ VN 02/03/2028 — năm nhuận, lùi qua 29/02)',
        '2028-03-01T18:00:00Z',
        {
          1: '2028-03-01T17:00:00.000Z',
          2: '2028-02-29T17:00:00.000Z',
          7: '2028-02-24T17:00:00.000Z',
        },
      ],
    ])('%s', (_label, systemTimeIso, expectedByDays) => {
      jest.useFakeTimers().setSystemTime(new Date(systemTimeIso));

      for (const [daysStr, expectedIso] of Object.entries(expectedByDays)) {
        const days = Number(daysStr);
        expect(startOfDayUtcDaysAgo(days).toISOString()).toBe(expectedIso);
      }
    });
  });
});
