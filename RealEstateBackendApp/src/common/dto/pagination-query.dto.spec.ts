/**
 * pagination-query.dto unit spec — contract mục 2 (phân trang chuẩn) +
 * mục 3 (Swagger @ApiPropertyOptional, class-validator).
 *
 * Bao phủ:
 * - Default values: page=1, limit=20.
 * - @Type(() => Number) ép string query sang number.
 * - @IsInt / @Min(1) cho page.
 * - @Min(1) / @Max(100) cho limit.
 * - Optional — thiếu field vẫn valid.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto, DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from './pagination-query.dto';

async function validateDto(
  input: Record<string, unknown>,
): Promise<{ dto: PaginationQueryDto; errors: string[] }> {
  const dto = plainToInstance(PaginationQueryDto, input, {
    enableImplicitConversion: true,
  });
  const errs = await validate(dto, { whitelist: true });
  return { dto, errors: errs.flatMap((e) => Object.values(e.constraints ?? {})) };
}

describe('PaginationQueryDto (contract mục 2/3)', () => {
  it('default page=1, limit=20 khi không truyền', async () => {
    const { dto, errors } = await validateDto({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(DEFAULT_PAGE);
    expect(dto.limit).toBe(DEFAULT_LIMIT);
  });

  it('thiếu page → default; thiếu limit → default', async () => {
    const r1 = await validateDto({ limit: 50 });
    expect(r1.errors).toHaveLength(0);
    expect(r1.dto.page).toBe(DEFAULT_PAGE);
    expect(r1.dto.limit).toBe(50);
  });

  it('@Type(() => Number) — ép chuỗi "2" thành number 2', async () => {
    const { dto, errors } = await validateDto({ page: '2', limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it('page=0 → vi phạm @Min(1)', async () => {
    const { errors } = await validateDto({ page: 0 });
    expect(errors.some((m) => /page tối thiểu là 1/.test(m))).toBe(true);
  });

  it('page âm → vi phạm @Min(1)', async () => {
    const { errors } = await validateDto({ page: -3 });
    expect(errors.some((m) => /page tối thiểu là 1/.test(m))).toBe(true);
  });

  it('page không phải số nguyên (1.5) → vi phạm @IsInt', async () => {
    const { errors } = await validateDto({ page: 1.5 });
    expect(errors.some((m) => /page phải là số nguyên/.test(m))).toBe(true);
  });

  it('limit=0 → vi phạm @Min(1)', async () => {
    const { errors } = await validateDto({ limit: 0 });
    expect(errors.some((m) => /limit tối thiểu là 1/.test(m))).toBe(true);
  });

  it(`limit=${MAX_LIMIT + 1} → vi phạm @Max(${MAX_LIMIT})`, async () => {
    const { errors } = await validateDto({ limit: MAX_LIMIT + 1 });
    expect(errors.some((m) => /limit tối đa/.test(m))).toBe(true);
  });

  it(`limit=${MAX_LIMIT} (boundary) → hợp lệ`, async () => {
    const { errors, dto } = await validateDto({ limit: MAX_LIMIT });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(MAX_LIMIT);
  });

  it('limit không phải số nguyên → vi phạm @IsInt', async () => {
    const { errors } = await validateDto({ limit: 2.5 });
    expect(errors.some((m) => /limit phải là số nguyên/.test(m))).toBe(true);
  });

  it('page=1, limit=20 → hợp lệ (boundary)', async () => {
    const { errors, dto } = await validateDto({ page: 1, limit: 20 });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('export hằng số DEFAULT_PAGE=1, DEFAULT_LIMIT=20, MAX_LIMIT=100', () => {
    expect(DEFAULT_PAGE).toBe(1);
    expect(DEFAULT_LIMIT).toBe(20);
    expect(MAX_LIMIT).toBe(100);
  });
});
