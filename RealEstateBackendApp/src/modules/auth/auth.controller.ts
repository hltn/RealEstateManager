import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dtos/login.dto';

/**
 * Cookie path cho refresh token.
 * Đặt `/api/v1/auth` (KHÔNG phải `/api/v1/auth/refresh` như doc gốc) để cả
 * endpoint /auth/refresh và /auth/logout đều nhận được cookie (logout cần
 * đọc token để revoke). Đây là deviate có lý do từ mục 6.1 — xem báo cáo.
 */
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_NAME = 'refreshToken';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login, returns access token + sets refresh cookie' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { accessToken, user, refreshToken } =
      await this.authService.login(dto);
    this.setRefreshCookie(reply, refreshToken);
    return { accessToken, user };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token, return new access token' })
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    if (!token) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const { accessToken, refreshToken } =
      await this.authService.refresh(token);
    this.setRefreshCookie(reply, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke refresh token + clear cookie (idempotent)' })
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    await this.authService.logout(token);
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() currentUser: JwtPayload) {
    return this.authService.getMe(String(currentUser?.sub));
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    reply.setCookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: 60 * 60 * 24 * 7, // 7 ngày
    });
  }
}
