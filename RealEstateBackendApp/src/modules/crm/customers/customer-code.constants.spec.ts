import {
  COUNTER_KEY,
  CUSTOMER_CODE_INDEX,
  formatCustomerCode,
  parseCustomerCodeSeq,
} from './customer-code.constants';

describe('customer-code.constants (T-01, FR-07, FR-08, FR-21)', () => {
  describe('formatCustomerCode (FR-07)', () => {
    it.each([
      [1, 'KH-000001'],
      [123, 'KH-000123'],
      [999_999, 'KH-999999'],
      [1_000_000, 'KH-1000000'],
      [12_345_678, 'KH-12345678'],
    ])('FR-07: seq %i -> %s', (seq, expected) => {
      expect(formatCustomerCode(seq)).toBe(expected);
    });

    it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
      'FR-07: seq không hợp lệ (%p) ném RangeError',
      (seq) => {
        expect(() => formatCustomerCode(seq)).toThrow(RangeError);
      },
    );
  });

  describe('parseCustomerCodeSeq (FR-07, FR-08)', () => {
    it.each([
      ['KH-000001', 1],
      ['KH-000123', 123],
      ['KH-999999', 999_999],
      ['KH-1000000', 1_000_000],
    ])('FR-08: %s -> %i', (code, seq) => {
      expect(parseCustomerCodeSeq(code)).toBe(seq);
    });

    it.each([
      '',
      'KH-',
      'KH-12', // thiếu đệm 0: không phải dạng chuẩn
      'kh-000012', // sai hoa/thường
      'KH000123',
      'KH-000000', // seq 0 không bao giờ được cấp
      'KH-0000001', // đệm 0 thừa
      'KH-00001a',
      ' KH-000001',
      'KH-000001 ',
      'KH--00001',
      'KH-99999999999999999999', // vượt số nguyên an toàn
      'XX-000001',
    ])('FR-07: sai định dạng %p -> null', (code) => {
      expect(parseCustomerCodeSeq(code)).toBeNull();
    });

    it('FR-07: đầu vào không phải chuỗi -> null', () => {
      expect(parseCustomerCodeSeq(null)).toBeNull();
      expect(parseCustomerCodeSeq(undefined)).toBeNull();
      expect(parseCustomerCodeSeq(123456)).toBeNull();
    });

    it('FR-07: parse là nghịch đảo của format', () => {
      for (const seq of [1, 42, 999_999, 1_000_000, 7_654_321]) {
        expect(parseCustomerCodeSeq(formatCustomerCode(seq))).toBe(seq);
      }
    });
  });

  describe('hằng số dùng chung (FR-07, FR-21)', () => {
    it('FR-07: COUNTER_KEY là CUSTOMER_CODE', () => {
      expect(COUNTER_KEY).toBe('CUSTOMER_CODE');
    });

    it('FR-21: CUSTOMER_CODE_INDEX là partial unique customerCode_1 (khớp migration 010)', () => {
      expect(CUSTOMER_CODE_INDEX.key).toEqual({ customerCode: 1 });
      expect(CUSTOMER_CODE_INDEX.options).toEqual({
        name: 'customerCode_1',
        unique: true,
        partialFilterExpression: { customerCode: { $type: 'string' } },
      });
    });

    it('FR-21: module không phụ thuộc NestJS/Mongoose (import được từ migration/CLI)', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const source = require('fs').readFileSync(
        require.resolve('./customer-code.constants.ts'),
        'utf8',
      ) as string;
      expect(source).not.toMatch(/from\s+['"](@nestjs|mongoose)/);
    });
  });
});
