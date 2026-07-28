/**
 * UpdateUserRoleDto unit spec — contract mục 16.4 (class-validator exact).
 *
 * DTO cập nhật role user (ADMIN/EDITOR). Không áp dụng rule "không đổi chính
 * mình" ở MVP — rule đó do controller tự bắt (xem users.controller.spec.ts).
 *
 * Bao phủ:
 * - role hợp lệ (ADMIN/EDITOR) → pass.
 * - role sai enum → fail (IsEnum).
 * - thiếu role → fail.
 * - role non-string → fail.
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { UpdateUserRoleDto } from './update-user-role.dto';
import { UserRole } from '../../../common/enums/user-role.enum';

/** Lấy message từ ValidationError — hỗ trợ cả string[] và string. */
function messages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    if (!e.constraints) continue;
    out.push(...Object.values(e.constraints));
  }
  return out;
}

describe('UpdateUserRoleDto (mục 16.4 — class-validator exact)', () => {
  it('role hợp lệ (ADMIN) → pass validate', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: UserRole.ADMIN }),
    );
    expect(errors).toHaveLength(0);
  });

  it('role hợp lệ (EDITOR) → pass validate', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: UserRole.EDITOR }),
    );
    expect(errors).toHaveLength(0);
  });

  it('role sai enum (GUEST) → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: 'GUEST' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('role sai enum (chuỗi bất kỳ) → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: 'SUPERADMIN' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('thiếu role → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, {}),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('role non-string (number) → fail IsEnum', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: 1 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /enum|value/i.test(m))).toBe(true);
  });

  it('role undefined → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: undefined }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('role null → fail (null không thuộc enum)', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: null }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
