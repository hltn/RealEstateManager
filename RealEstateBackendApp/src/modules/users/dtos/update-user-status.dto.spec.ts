/**
 * UpdateUserStatusDto unit spec — contract mục 16.4 (class-validator exact).
 *
 * DTO cập nhật trạng thái user (block/unblock). Rule "không block chính mình"
 * kiểm tra ở controller (trước khi gọi service) — DTO chỉ validate enum.
 *
 * Bao phủ:
 * - status hợp lệ (ACTIVE/BLOCKED) → pass.
 * - status sai enum → fail (IsEnum).
 * - thiếu status → fail.
 * - status non-string / null → fail.
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { UpdateUserStatusDto } from './update-user-status.dto';
import { UserStatus } from '../../../common/enums/user-status.enum';

/** Lấy message từ ValidationError — hỗ trợ cả string[] và string. */
function messages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    if (!e.constraints) continue;
    out.push(...Object.values(e.constraints));
  }
  return out;
}

describe('UpdateUserStatusDto (mục 16.4 — class-validator exact)', () => {
  it('status hợp lệ (ACTIVE) → pass validate', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: UserStatus.ACTIVE }),
    );
    expect(errors).toHaveLength(0);
  });

  it('status hợp lệ (BLOCKED) → pass validate', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: UserStatus.BLOCKED }),
    );
    expect(errors).toHaveLength(0);
  });

  it('status sai enum (DELETED) → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: 'DELETED' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('status sai enum (chuỗi bất kỳ) → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: 'PENDING' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('thiếu status → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, {}),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('status non-string (number) → fail IsEnum', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: 1 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /enum|value/i.test(m))).toBe(true);
  });

  it('status undefined → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: undefined }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('status null → fail (null không thuộc enum)', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: null }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
