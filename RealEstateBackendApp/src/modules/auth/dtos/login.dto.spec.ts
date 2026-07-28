/**
 * DTO validation spec — contract mục 16.4 (class-validator exact).
 *
 * Bao phủ LoginDto, CreateUserDto, UpdateUserStatusDto, UpdateUserRoleDto.
 * Quy tắc: lỗi validate → `message` dạng `string[]` (class-validator trả mảng).
 * Test phải xử lý cả hai dạng `string` và `string[]` (mục 6.3/16.5).
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { LoginDto } from './login.dto';
import { CreateUserDto } from '../../users/dtos/create-user.dto';
import { UpdateUserStatusDto } from '../../users/dtos/update-user-status.dto';
import { UpdateUserRoleDto } from '../../users/dtos/update-user-role.dto';
import { UserRole } from '../../../common/enums/user-role.enum';
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

describe('LoginDto (mục 16.4)', () => {
  it('email hợp lệ + password >=8 → pass validate', async () => {
    const dto = plainToInstance(LoginDto, {
      email: '  Admin@Example.COM  ',
      password: 'Admin@123456',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    // Transform trim + lowercase — chuẩn hoá để so khớp DB.
    expect(dto.email).toBe('admin@example.com');
  });

  it('email sai format → fail, message chứa lỗi email', async () => {
    const errors = await validate(
      plainToInstance(LoginDto, { email: 'not-email', password: '12345678' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /email/i.test(m))).toBe(true);
  });

  it('password < 8 ký tự → fail, message chứa MinLength', async () => {
    const errors = await validate(
      plainToInstance(LoginDto, {
        email: 'admin@example.com',
        password: 'short',
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /8|shorter|length/i.test(m))).toBe(
      true,
    );
  });

  it('thiếu password → fail', async () => {
    const errors = await validate(
      plainToInstance(LoginDto, { email: 'admin@example.com' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('CreateUserDto (mục 16.4)', () => {
  const valid = {
    email: 'editor@example.com',
    password: 'Editor@123456',
    displayName: 'Editor One',
    role: UserRole.EDITOR,
  };

  it('payload hợp lệ → pass validate', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, valid),
    );
    expect(errors).toHaveLength(0);
  });

  it('displayName < 2 ký tự → fail MinLength', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, displayName: 'A' }),
    );
    expect(errors.length).toBeGreaterThan(0);
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

  it('role sai enum (không phải ADMIN/EDITOR) → fail', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, role: 'SUPERADMIN' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('password < 8 → fail', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { ...valid, password: 'short' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateUserStatusDto (mục 16.4)', () => {
  it('status hợp lệ (ACTIVE/BLOCKED) → pass', async () => {
    for (const s of [UserStatus.ACTIVE, UserStatus.BLOCKED]) {
      const errors = await validate(
        plainToInstance(UpdateUserStatusDto, { status: s }),
      );
      expect(errors).toHaveLength(0);
    }
  });

  it('status sai enum → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserStatusDto, { status: 'DELETED' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateUserRoleDto (mục 16.4)', () => {
  it('role hợp lệ (ADMIN/EDITOR) → pass', async () => {
    for (const r of [UserRole.ADMIN, UserRole.EDITOR]) {
      const errors = await validate(
        plainToInstance(UpdateUserRoleDto, { role: r }),
      );
      expect(errors).toHaveLength(0);
    }
  });

  it('role sai enum → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserRoleDto, { role: 'GUEST' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
