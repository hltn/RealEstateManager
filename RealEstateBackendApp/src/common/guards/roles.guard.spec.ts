/**
 * TEST-FIRST (TDD) — RolesGuard unit spec.
 *
 * Viết TRƯỚC khi `coder-backend-agent` tạo impl. Spec này là deliverable hợp lệ
 * kể cả khi `./roles.guard` chưa tồn tại — jest sẽ báo "Cannot find module"
 * (đúng kỳ vọng test-first, KHÔNG tạo stub impl).
 *
 * Contract đối chiếu:
 *   - AUTH_MODULE_ARCHITECTURE.md mục 8 (Guards & Decorators — RolesGuard)
 *   - mục 6.3 (error message exact: "Insufficient role")
 *   - mục 11 (RBAC matrix: EDITOR ❌ / ADMIN ✅ cho user endpoints)
 *   - mục 16.8 (FastifyRequest mock shape)
 *   - mục 16.2 (payload.role đọc từ request.user do JwtAuthGuard gắn)
 *
 * Quy tắc: KHÔNG dùng DB, KHÔNG bootstrap app. Pure unit — khởi tạo thủ công
 * `new RolesGuard(reflector)` với Reflector mock bằng `jest.fn()`.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';

/**
 * Tạo mock ExecutionContext theo mục 16.8 — FastifyRequest shape.
 * `request.user` do JwtAuthGuard gắn (payload `{ sub, email, role }`).
 */
function createMockContext(user: unknown): ExecutionContext {
  const request = { headers: {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (canActivate) — contract mục 8 + 11', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: RolesGuard;

  beforeEach(() => {
    // Reflector.getAllAndOverride(key, [handler, class]) — đọc metadata từ cả
    // handler lẫn class (mục 8: "đọc ROLES_KEY metadata từ handler và class").
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('KHÔNG có @Roles metadata → pass (authenticated là đủ) (mục 8)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext({ sub: 'u1', email: 'a@b.c', role: UserRole.EDITOR });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('request.user.role thuộc allowedRoles → true (ADMIN gọi endpoint @Roles(ADMIN)) (mục 11)', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext({ sub: 'u1', email: 'a@b.c', role: UserRole.ADMIN });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('EDITOR gọi endpoint @Roles(ADMIN) → throw ForbiddenException("Insufficient role") (mục 6.3 + 11)', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext({ sub: 'u1', email: 'a@b.c', role: UserRole.EDITOR });

    try {
      guard.canActivate(ctx);
      fail('Expected ForbiddenException to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        message: string;
      };
      expect(response.message).toBe('Insufficient role');
    }
  });

  it('request.user undefined → throw ForbiddenException (không crash)', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    // Giống JwtAuthGuard bypass thất bại — guard phòng thủ: không đọc .role của undefined.
    const ctx = createMockContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('đọc metadata từ cả handler lẫn class (getAllAndOverride merge)', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const handler = function handler() {};
    const klass = class Controller {};
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.ADMIN } }) }),
      getHandler: () => handler,
      getClass: () => klass,
    } as unknown as ExecutionContext;

    guard.canActivate(ctx);

    // Phải truyền cả [handler, class] để Reflector merge 2 cấp (mục 8).
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [handler, klass]);
  });

  it('nhiều role cho phép — role khớp 1 trong danh sách → true', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.EDITOR]);
    const ctx = createMockContext({ role: UserRole.EDITOR });

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
