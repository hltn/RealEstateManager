import { ErrorCode } from '../../../common/exceptions/error-codes';
import { normalizeOptionalPhoneOrThrow } from './customer.errors';

describe('normalizeOptionalPhoneOrThrow (FR-01)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   '],
  ])('FR-01: %s => null (khách không có SĐT, không ném lỗi)', (_n, input) => {
    expect(normalizeOptionalPhoneOrThrow(input)).toBeNull();
  });

  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['+84 912-345-678', '+84912345678'],
  ])('FR-01: %s => %s (E.164)', (input, expected) => {
    expect(normalizeOptionalPhoneOrThrow(input)).toBe(expected);
  });

  it.each(['abc', '123', '+84 12'])(
    'FR-01: "%s" có giá trị nhưng sai định dạng => 400 INVALID_PHONE',
    (input) => {
      let caught: unknown;
      try {
        normalizeOptionalPhoneOrThrow(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        status: 400,
        response: { errorCode: ErrorCode.INVALID_PHONE },
      });
    },
  );
});
