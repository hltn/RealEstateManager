/**
 * AuthController unit spec — contract mục 6.1 / 6.3 / 8 (FastifyRequest shape).
 *
 * Bao phủ 4 endpoints:
 * - POST /auth/login → gọi authService.login, set refresh cookie, trả { accessToken, user }.
 * - POST /auth/refresh → đọc cookie `refreshToken`; thiếu → 401 "Invalid or expired refresh token";
 *   đủ → gọi authService.refresh, set cookie mới, trả { accessToken }.
 * - POST /auth/logout → gọi authService.logout (idempotent), clear cookie, trả
 *   { message: "Logged out successfully" }.
 * - GET /auth/me → gọi authService.getMe với sub từ payload.
 *
 * Mock FastifyRequest/FastifyReply shape (KHÔNG Express — mục 16.8):
 * - `req.cookies` là object (do @fastify/cookie parse, guard không đọc raw cookie).
 * - `reply.setCookie` / `reply.clearCookie` từ @fastify/cookie.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from '../../common/enums/user-role.enum';

function mockReply(): FastifyReply {
  return {
    setCookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as FastifyReply;
}

function mockRequest(cookies: Record<string, string> = {}): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

describe('AuthController — contract mục 6.1/6.3', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getMe: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/login', () => {
    it('login thành công → set refresh cookie + trả { accessToken, user } (mục 6.1)', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'access.jwt',
        refreshToken: 'refresh-uuid',
        user: {
          _id: '65e1f0a1b2c3d4e5f6a7b8c9',
          email: 'admin@example.com',
          displayName: 'System Admin',
          role: UserRole.ADMIN,
        },
      });
      const reply = mockReply();

      const result = await controller.login(
        { email: 'admin@example.com', password: 'Admin@123456' },
        reply,
      );

      expect(authService.login).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'Admin@123456',
      });
      // Refresh cookie: HttpOnly, SameSite=Strict, Path=/api/v1/auth, maxAge 7 ngày.
      expect(reply.setCookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-uuid',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/v1/auth',
          maxAge: 60 * 60 * 24 * 7,
        }),
      );
      // Response KHÔNG trả refresh token raw (chỉ qua cookie).
      expect(result).toEqual({
        accessToken: 'access.jwt',
        user: expect.objectContaining({ email: 'admin@example.com' }),
      });
      expect((result as any).refreshToken).toBeUndefined();
    });
  });

  describe('POST /auth/refresh', () => {
    it('thiếu cookie refreshToken → UnauthorizedException("Invalid or expired refresh token") (mục 6.3)', async () => {
      const req = mockRequest({});
      const reply = mockReply();

      await expect(controller.refresh(req, reply)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.refresh(req, reply)).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('có cookie → gọi authService.refresh, set cookie mới, trả { accessToken } (mục 6.1)', async () => {
      const req = mockRequest({ refreshToken: 'old-uuid' });
      const reply = mockReply();
      authService.refresh.mockResolvedValue({
        accessToken: 'new.access.jwt',
        refreshToken: 'new-refresh-uuid',
      });

      const result = await controller.refresh(req, reply);

      expect(authService.refresh).toHaveBeenCalledWith('old-uuid');
      expect(reply.setCookie).toHaveBeenCalledWith(
        'refreshToken',
        'new-refresh-uuid',
        expect.any(Object),
      );
      expect(result).toEqual({ accessToken: 'new.access.jwt' });
    });
  });

  describe('POST /auth/logout', () => {
    it('logout → gọi authService.logout + clear cookie + trả { message: "Logged out successfully" } (mục 6.1)', async () => {
      const req = mockRequest({ refreshToken: 'some-uuid' });
      const reply = mockReply();
      authService.logout.mockResolvedValue();

      const result = await controller.logout(req, reply);

      expect(authService.logout).toHaveBeenCalledWith('some-uuid');
      expect(reply.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ path: '/api/v1/auth' }),
      );
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('logout idempotent — thiếu cookie vẫn trả message thành công', async () => {
      const req = mockRequest({});
      const reply = mockReply();
      authService.logout.mockResolvedValue();

      const result = await controller.logout(req, reply);

      // authService.logout(undefined) → no-op; controller vẫn clear cookie + message.
      expect(authService.logout).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('GET /auth/me', () => {
    it('me → gọi authService.getMe với String(currentUser.sub) (mục 5.1/6.1)', async () => {
      authService.getMe.mockResolvedValue({
        _id: '65e1f0a1b2c3d4e5f6a7b8c9',
        email: 'admin@example.com',
        displayName: 'System Admin',
        role: UserRole.ADMIN,
        status: 'ACTIVE' as any,
      });

      const result = await controller.me({
        sub: '65e1f0a1b2c3d4e5f6a7b8c9',
        email: 'admin@example.com',
        role: UserRole.ADMIN,
      });

      expect(authService.getMe).toHaveBeenCalledWith(
        '65e1f0a1b2c3d4e5f6a7b8c9',
      );
      // /auth/me trả kèm status (khác login chỉ trả UserPublicDto).
      expect(result).toEqual(
        expect.objectContaining({
          _id: '65e1f0a1b2c3d4e5f6a7b8c9',
          email: 'admin@example.com',
        }),
      );
    });
  });
});
