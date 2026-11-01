import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CreateProjectDto } from './dtos/project.dto';
import {
  assertPriceRange,
  normalizeProjectCode,
  normalizePropertyTypes,
} from './project.rules';

const invalidProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(CreateProjectDto, payload)).map(
    (error) => error.property,
  );

describe('Quy tắc mã dự án (CreateProjectDto.code)', () => {
  const base = { name: 'Dự án A' };

  it.each(['QTERRA', 'q_terra-1', 'A', 'a'.repeat(20)])(
    'chấp nhận mã hợp lệ %p',
    (code) => {
      expect(invalidProperties({ ...base, code })).toEqual([]);
    },
  );

  it.each([
    ['rỗng', ''],
    ['21 ký tự', 'a'.repeat(21)],
    ['có khoảng trắng giữa', 'AB CD'],
    ['có dấu tiếng Việt', 'Đạt'],
    ['ký tự đặc biệt', 'AB.CD'],
  ])('từ chối mã %s', (_label, code) => {
    expect(invalidProperties({ ...base, code })).toContain('code');
  });

  it('cắt khoảng trắng đầu/cuối trước khi kiểm (" abc " hợp lệ)', () => {
    const dto = plainToInstance(CreateProjectDto, { ...base, code: ' abc ' });
    expect(dto.code).toBe('abc');
    expect(validateSync(dto)).toEqual([]);
  });

  it('chuẩn hóa so trùng: chữ HOA, không phân biệt hoa thường', () => {
    expect(normalizeProjectCode('QTerra')).toBe(normalizeProjectCode('qterra'));
    expect(normalizeProjectCode(' qterra ')).toBe('QTERRA');
  });
});

describe('assertPriceRange', () => {
  it('cho phép khi thiếu một đầu hoặc from <= to', () => {
    expect(() => assertPriceRange(null, 10)).not.toThrow();
    expect(() => assertPriceRange(10, undefined)).not.toThrow();
    expect(() => assertPriceRange(10, 10)).not.toThrow();
    expect(() => assertPriceRange(0, 5)).not.toThrow();
  });

  it('priceFrom > priceTo => 400 VALIDATION_FAILED', () => {
    let thrown: unknown;
    try {
      assertPriceRange(11, 10);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BusinessException);
    expect((thrown as BusinessException).errorCode).toBe(
      ErrorCode.VALIDATION_FAILED,
    );
    expect((thrown as BusinessException).getStatus()).toBe(400);
  });
});

describe('normalizePropertyTypes (quy ước migration: luôn là mảng)', () => {
  it('bọc chuỗi đơn của dữ liệu cũ thành mảng 1 phần tử', () => {
    expect(normalizePropertyTypes('Căn hộ')).toEqual(['Căn hộ']);
  });

  it('null/undefined => mảng rỗng', () => {
    expect(normalizePropertyTypes(null)).toEqual([]);
    expect(normalizePropertyTypes(undefined)).toEqual([]);
  });

  it('bỏ rỗng/sai kiểu/trùng (không phân biệt hoa thường và dấu), giữ thứ tự và cách viết đầu tiên', () => {
    expect(
      normalizePropertyTypes([
        ' Căn hộ ',
        'can ho',
        '',
        3,
        'Shophouse',
        'SHOPHOUSE',
      ]),
    ).toEqual(['Căn hộ', 'Shophouse']);
  });
});
