import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CreateProjectDto, UpdateProjectDto } from './dtos/project.dto';
import {
  assertPriceRange,
  assertProjectCodeChange,
  normalizeProjectCode,
  normalizePropertyTypes,
} from './project.rules';

const invalidProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(CreateProjectDto, payload)).map(
    (error) => error.property,
  );

const invalidUpdateProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(UpdateProjectDto, payload)).map(
    (error) => error.property,
  );

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('Quy tắc mã dự án mới (CreateProjectDto.code, PT-031)', () => {
  const base = { name: 'Dự án A' };

  it.each(['QTERRA', 'A', 'a', 'qterra2', '9', 'a'.repeat(30)])(
    'chấp nhận mã hợp lệ %p (1-30 ký tự, chữ thường vẫn hợp lệ)',
    (code) => {
      expect(invalidProperties({ ...base, code })).toEqual([]);
    },
  );

  it.each([
    ['rỗng', ''],
    ['31 ký tự', 'a'.repeat(31)],
    ['có khoảng trắng giữa', 'AB CD'],
    ['có dấu tiếng Việt', 'Đạt'],
    ['có dấu thanh', 'Sài'],
    ['có "_"', 'AB_CD'],
    ['có "-"', 'AB-CD'],
    ['ký tự đặc biệt', 'AB.CD'],
    ['mã cũ dạng q_terra-1', 'q_terra-1'],
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

describe('UpdateProjectDto.code: DTO chỉ kiểm nới để PATCH giữ nguyên mã cũ', () => {
  it.each(['OLD_CODE', 'old-code', 'NEW1', 'a'.repeat(30)])(
    'qua DTO với %p (service mới kiểm chặt theo mã hiện có)',
    (code) => {
      expect(invalidUpdateProperties({ code })).toEqual([]);
    },
  );

  it.each([
    ['31 ký tự', 'a'.repeat(31)],
    ['có khoảng trắng', 'AB CD'],
    ['có dấu tiếng Việt', 'Đạt'],
    ['ký tự đặc biệt', 'AB.CD'],
    ['rỗng', ''],
  ])('từ chối mã %s ngay ở DTO', (_label, code) => {
    expect(invalidUpdateProperties({ code })).toContain('code');
  });

  it('không gửi code thì hợp lệ', () => {
    expect(invalidUpdateProperties({ name: 'Mới' })).toEqual([]);
  });

  it('cắt khoảng trắng đầu/cuối TRƯỚC khi kiểm nới (" old_code " => "old_code")', () => {
    const dto = plainToInstance(UpdateProjectDto, { code: ' old_code ' });
    expect(dto.code).toBe('old_code');
    expect(validateSync(dto)).toEqual([]);
  });

  it('mã cũ dài đúng 20 ký tự có "-"/"_" qua DTO; 30 ký tự có "-" cũng qua (kiểm chặt ở service)', () => {
    expect(invalidUpdateProperties({ code: 'LEG_ACY-CODE_20-CHAR' })).toEqual(
      [],
    );
    expect(invalidUpdateProperties({ code: `${'A-'.repeat(15)}` })).toEqual([]);
  });

  it('code: null qua DTO (IsOptional) — service mới là nơi chặn null', () => {
    expect(invalidUpdateProperties({ code: null })).toEqual([]);
  });
});

describe('assertProjectCodeChange (PATCH mã, PT-031)', () => {
  it('gửi lại đúng mã cũ có "_"/"-" (khác hoa thường) => qua', () => {
    expect(() => assertProjectCodeChange('old_code', 'OLD_CODE')).not.toThrow();
    expect(() => assertProjectCodeChange('OLD-1', 'OLD-1')).not.toThrow();
  });

  it('đổi sang mã mới theo quy tắc mới => qua', () => {
    expect(() => assertProjectCodeChange('NEWCODE', 'OLD_CODE')).not.toThrow();
  });

  it('mã hiện có truyền dạng thô (chưa chuẩn hóa, chữ thường/khoảng trắng) vẫn so đúng', () => {
    expect(() => assertProjectCodeChange('OLD_CODE', 'old_code')).not.toThrow();
    expect(() =>
      assertProjectCodeChange('OLD_CODE', ' old_code '),
    ).not.toThrow();
  });

  it.each([null, undefined, ''])(
    'mã hiện có thiếu (%p): mã gửi lên phải theo quy tắc mới',
    (current) => {
      expect(() => assertProjectCodeChange('NEWCODE', current)).not.toThrow();
      expect(
        thrownBy(() => assertProjectCodeChange('OLD_CODE', current)),
      ).toBeInstanceOf(BusinessException);
    },
  );

  it('chỉ đổi hoa/thường của mã đã hợp lệ => qua', () => {
    expect(() => assertProjectCodeChange('qterra', 'QTERRA')).not.toThrow();
  });

  it.each(['NEW_CODE', 'NEW-CODE', 'OLD_CODE2'])(
    'đổi sang mã khác còn "-"/"_" (%p) => 400 VALIDATION_FAILED',
    (code) => {
      const error = thrownBy(() => assertProjectCodeChange(code, 'OLD_CODE'));
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).errorCode).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      expect((error as BusinessException).getStatus()).toBe(400);
    },
  );

  it('400 mang details.fields=["code"] để FE gắn lỗi vào đúng ô', () => {
    const error = thrownBy(() =>
      assertProjectCodeChange('NEW_CODE', 'OLD_CODE'),
    );
    expect((error as BusinessException).getResponse()).toMatchObject({
      details: { fields: ['code'] },
    });
  });

  it.each([
    ['31 ký tự không "-"/"_"', 'A'.repeat(31)],
    ['có khoảng trắng giữa', 'AB CD'],
    ['có dấu', 'Đạt'],
  ])('đổi sang mã khác %s => 400 (kiểm chặt dù DTO nới)', (_label, code) => {
    expect(
      thrownBy(() => assertProjectCodeChange(code, 'OLD_CODE')),
    ).toBeInstanceOf(BusinessException);
  });

  it('mã hiện có đã theo quy tắc mới: đổi sang mã có "_" bị từ chối', () => {
    expect(thrownBy(() => assertProjectCodeChange('A_B', 'AB'))).toBeInstanceOf(
      BusinessException,
    );
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
