/**
 * TEST-FIRST (TDD) — JwtAuthGuard unit spec.
 *
 * Viết TRƯỚC khi `coder-backend-agent` tạo impl. Spec này là deliverable hợp lệ
 * kể cả khi `./jwt-auth.guard` chưa tồn tại — jest sẽ báo "Cannot find module"
 * (đúng kỳ vọng test-first, KHÔNG tạo stub impl). Có thể `@nestjs/jwt` cũng chưa
 * cài → cùng cảnh báo, backend sở hữu việc cài package.
 *
 * Contract đối chiếu:
 *   - AUTH_MODULE_ARCHITECTURE.md mục 8 (Guards & Decorators — JwtAuthGuard, Fastify note)
 *   - mục 5.1 + 16.2 (payload claims: { sub, email, role, iat, exp }, sub là ObjectId string)
 *   - mục 6.3 (error exact: "Missing or invalid access token")
 *   - mục 16.8 (FastifyRequest mock shape)
 *
 * Quy tắc: KHÔNG dùng DB, KHÔNG bootstrap app. Pure unit — khởi tạo thủ công
 * `new JwtAuthGuard(reflector, jwtService)` với mock bằng `jest.fn()`.
 * KHÔNG assert bất kỳ Model method nào (mục 16.2: guard không query DB).
 */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserRole } from '../enums/user-role.enum';

/**
 * Mock ExecutionContext theo mục 16.8 — FastifyRequest shape (KHÔNG Express).
 * `request.headers.authorization` dạng `'Bearer <token>'`; `request.user` = undefined
 * trước khi guard gắn payload.
 */
function createMockContext(
  authorization: string | undefined,
  user: unknown = undefined,
): ExecutionContext {
  const request = {
    headers: authorization === undefined ? {} : { authorization },
    user,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const VALID_PAYLOAD = {
  sub: '65e1f0a1b2c3d4e5f6a7b8c9',
  email: 'admin@example.com',
  role: UserRole.ADMIN,
  iat: 1710000000,
  exp: 1710000900,
};

describe('JwtAuthGuard (canActivate) — contract mục 8 + 5.1', () => {
  let reflector: jest.Mocked<Reflector>;
  let jwtService: jest.Mocked<JwtService>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    jwtService = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    guard = new JwtAuthGuard(reflector, jwtService);
    jwtService.verify.mockReturnValue(VALID_PAYLOAD);
  });

  it('route @Public (IS_PUBLIC_KEY=true) → true, KHÔNG gọi jwtService.verify (mục 8)', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext(undefined);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('Authorization: Bearer <validToken> → verify gọi 1 lần, request.user = payload, trả true (mục 8 + 5.1)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext('Bearer valid.jwt.token');
    const request = ctx.switchToHttp().getRequest();

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledTimes(1);
    expect(jwtService.verify).toHaveBeenCalledWith('valid.jwt.token');
    // Guard gắn nguyên payload vào request.user — RolesGuard/@CurrentUser đọc từ đây.
    expect(request.user).toEqual(VALID_PAYLOAD);
  });

  it('verify payload shape: sub (ObjectId string), email, role, iat, exp — KHÔNG query DB (mục 5.1 + 16.2)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext('Bearer valid.jwt.token');
    guard.canActivate(ctx);

    const user = ctx.switchToHttp().getRequest().user as Record<string, unknown>;
    expect(typeof user.sub).toBe('string');
    expect(user.sub).toBe('65e1f0a1b2c3d4e5f6a7b8c9');
    expect(user.email).toBe('admin@example.com');
    expect(user.role).toBe(UserRole.ADMIN);
    expect(typeof user.iat).toBe('number');
    expect(typeof user.exp).toBe('number');
    // Không nhét password hash / refresh hash vào payload (mục 5.1 quy tắc).
    expect(user.password).toBeUndefined();
  });

  it('thiếu header authorization → throw UnauthorizedException("Missing or invalid access token") (mục 6.3)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow(
      'Missing or invalid access token',
    );
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('header sai prefix (thiếu "Bearer ") → throw cùng message (mục 6.3)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext('Token valid.jwt.token');

    expect(() => guard.canActivate(ctx)).toThrow('Missing or invalid access token');
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('jwtService.verify throw (token invalid/expired) → bắt & chuẩn hoá UnauthorizedException("Missing or invalid access token") (mục 6.3)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt malformed');
    });
    const ctx = createMockContext('Bearer bad.jwt.token');

    expect(() => guard.canActivate(ctx)).toThrow('Missing or invalid access token');
    expect(jwtService.verify).toHaveBeenCalledTimes(1);
  });

  it('header "Bearer " rỗng (không có token) → throw (mục 6.3)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext('Bearer ');

    expect(() => guard.canActivate(ctx)).toThrow('Missing or invalid access token');
    expect(jwtService.verify).not.toHaveBeenCalled();
  });
});
