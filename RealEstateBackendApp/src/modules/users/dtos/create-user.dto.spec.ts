/**
 * CreateUserDto unit spec — contract mục 16.4 (class-validator exact).
 *
 * DTO tạo user (ADMIN only). Email unique check thực hiện ở DB (service
 * throw ConflictException khi trùng) — DTO chỉ validate format.
 *
 * Bao phủ:
 * - payload hợp lệ → pass validate.
 * - email sai format → fail (IsEmail).
 * - password < 8 ký tự → fail (MinLength).
 * - displayName < 2 ký tự → fail (MinLength).
 * - displayName > 50 ký tự → fail (MaxLength).
 * - role sai enum → fail (IsEnum).
 * - thiếu từng field → fail.
 *
 * Lưu ý: `login.dto.spec.ts` đã có vài case, file này viết đầy đủ độc lập
 * cho CreateUserDto theo yêu cầu "spec cạnh source".
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
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

describe('CreateUserDto (mục 16.4 — class-validator exact)', () => {
  const valid = {
    email: 'editor@example.com',
    password: 'Editor@123456',
    displayName: 'Editor One',
    role: UserRole.EDITOR,
  };

  it('payload hợp lệ → pass validate (0 error)', async () => {
    const errors = await validate(plainToInstance(CreateUserDto, valid));
    expect(errors).toHaveLength(0);
  });

  it('chấp nhận mọi giá trị role trong UserRole enum (ADMIN/EDITOR)', async () => {
    for (const r of [UserRole.ADMIN, UserRole.EDITOR]) {
      const errors = await validate(
        plainToInstance(CreateUserDto, { ...valid, role: r }),
      );
      expect(errors).toHaveLength(0);
    }
  });

  it('email sai format → fail, message chứa lỗi email', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, email: 'not-email' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /email/i.test(m))).toBe(true);
  });

  it('email thiếu → fail', async () => {
    const { email: _email, ...rest } = valid;
    const errors = await validate(plainToInstance(CreateUserDto, rest));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('password < 8 ký tự → fail MinLength', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, password: 'short' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /8|shorter|length/i.test(m))).toBe(
      true,
    );
  });

  it('password đúng 8 ký tự → pass (boundary MinLength)', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, password: '12345678' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('thiếu password → fail', async () => {
    const { password: _password, ...rest } = valid;
    const errors = await validate(plainToInstance(CreateUserDto, rest));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('displayName < 2 ký tự → fail MinLength', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, displayName: 'A' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('displayName đúng 2 ký tự → pass (boundary MinLength)', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, displayName: 'AB' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('displayName đúng 50 ký tự → pass (boundary MaxLength)', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        ...valid,
        displayName: 'A'.repeat(50),
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('displayName > 50 ký tự → fail MaxLength', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        ...valid,
        displayName: 'A'.repeat(51),
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('thiếu displayName → fail', async () => {
    const { displayName: _displayName, ...rest } = valid;
    const errors = await validate(plainToInstance(CreateUserDto, rest));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('role sai enum (không phải ADMIN/EDITOR) → fail', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, role: 'SUPERADMIN' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('thiếu role → fail', async () => {
    const { role: _role, ...rest } = valid;
    const errors = await validate(plainToInstance(CreateUserDto, rest));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('email non-string (number) → fail IsEmail', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, email: 12345 }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
