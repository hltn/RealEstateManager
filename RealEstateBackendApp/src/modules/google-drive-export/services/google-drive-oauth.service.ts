import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { google, type OAuth2Client } from 'googleapis';
import { createHmac, randomBytes } from 'node:crypto';
import {
  GoogleDriveToken,
  GoogleDriveTokenDocument,
} from '../schemas/google-drive-token.schema';

/**
 * GoogleDriveOAuthService — quản lý OAuth2 flow với Google Drive.
 *
 * Scope: `drive.file` (non-sensitive, đủ cho create doc + write content + move).
 * Auto-refresh: google-auth-library xử lý; event 'tokens' → save to DB.
 *
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_OAUTH_STATE_SECRET.
 */
@Injectable()
export class GoogleDriveOAuthService {
  private readonly logger = new Logger(GoogleDriveOAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(GoogleDriveToken.name)
    private readonly tokenModel: Model<GoogleDriveTokenDocument>,
  ) {}

  /**
   * Tạo OAuth2 URL để frontend redirect user sang Google consent screen.
   * scope: drive.file, access_type: offline, prompt: consent.
   * state param = userId:nonce:signature để CSRF protection.
   */
  generateAuthUrl(userId: string): string {
    const oauth2Client = this.createBaseOAuth2Client();

    const state = this.signState(userId);

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      state,
    });
  }

  /**
   * Validate OAuth state parameter — verify HMAC signature to prevent CSRF.
   * Returns the original userId if valid, throws UnauthorizedException if not.
   */
  validateOAuthState(state: string): string {
    if (!state) {
      throw new UnauthorizedException('Missing state parameter');
    }

    const parts = state.split(':');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid state parameter format');
    }

    const [userId, nonce, providedSignature] = parts;
    const expectedSignature = this.computeSignature(userId, nonce);

    if (!timingSafeEqual(providedSignature, expectedSignature)) {
      throw new UnauthorizedException('Invalid state parameter (CSRF detected)');
    }

    return userId;
  }

  /**
   * Exchange authorization code → lấy tokens + email → upsert vào DB.
   * Google trả về refresh_token chỉ lần đầu (prompt: consent).
   *
   * @param code - Authorization code từ Google redirect
   * @param userId - userId từ state param (Google redirect)
   */
  async exchangeCode(
    code: string,
    userId: string,
  ): Promise<{
    userId: string;
    email: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    const oauth2Client = this.createBaseOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new UnauthorizedException(
        'Failed to obtain tokens from Google. Please try again.',
      );
    }

    // Lấy email từ Google userinfo endpoint.
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client as any });
    const { data: userInfo } = await oauth2.userinfo.get();

    const expiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600_000);

    // Upsert token — 1 user = 1 token document.
    await this.tokenModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
          email: userInfo.email ?? null,
          scope: tokens.scope ?? null,
        },
      },
      { upsert: true, new: true },
    );

    return {
      userId,
      email: userInfo.email ?? '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    };
  }

  /**
   * Load token từ DB → tạo OAuth2Client → setCredentials.
   * Lắng nghe event 'tokens' một lần (removeListener sau khi fired) để auto-save khi refresh.
   * Throw UnauthorizedException nếu user chưa connect.
   */
  async getOAuth2Client(userId: string): Promise<OAuth2Client> {
    const tokenDoc = await this.tokenModel.findOne({ userId }).exec();
    if (!tokenDoc) {
      throw new UnauthorizedException(
        'Google Drive not connected. Please connect first.',
      );
    }

    const oauth2Client = this.createBaseOAuth2Client();
    oauth2Client.setCredentials({
      access_token: tokenDoc.accessToken,
      refresh_token: tokenDoc.refreshToken,
      expiry_date: tokenDoc.expiresAt.getTime(),
    });

    // Auto-save tokens khi refresh — use once() to prevent listener leak.
    const tokensListener = async (tokens: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
    }) => {
      try {
        if (tokens.refresh_token) {
          await this.tokenModel.findOneAndUpdate(
            { userId },
            {
              $set: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: new Date(
                  tokens.expiry_date ?? Date.now() + 3600_000,
                ),
              },
            },
          );
        } else {
          await this.tokenModel.findOneAndUpdate(
            { userId },
            {
              $set: {
                accessToken: tokens.access_token,
                expiresAt: new Date(
                  tokens.expiry_date ?? Date.now() + 3600_000,
                ),
              },
            },
          );
        }
        this.logger.log(`Tokens auto-saved for user ${userId}`);
      } catch (err) {
        this.logger.error(
          `Failed to auto-save tokens for user ${userId}`,
          err,
        );
      }
    };

    // Use 'once' instead of 'on' to prevent listener accumulation.
    oauth2Client.once('tokens', tokensListener);

    return oauth2Client;
  }

  /**
   * Revoke token trên Google → xóa khỏi DB.
   * Idempotent: xử lý trường hợp token đã revoke.
   */
  async revokeAndDelete(userId: string): Promise<void> {
    const tokenDoc = await this.tokenModel.findOne({ userId }).exec();
    if (!tokenDoc) {
      throw new UnauthorizedException('Google Drive not connected.');
    }

    try {
      const oauth2Client = this.createBaseOAuth2Client();
      oauth2Client.setCredentials({
        access_token: tokenDoc.accessToken,
        refresh_token: tokenDoc.refreshToken,
      });
      await (oauth2Client as any).revokeCredentials();
    } catch {
      // Token có thể đã bị revoke — log và tiếp tục xoá DB.
      this.logger.warn(
        `Failed to revoke token on Google for user ${userId} (may already be revoked)`,
      );
    }

    await this.tokenModel.deleteOne({ userId }).exec();
  }

  /**
   * Lookup token info — trả trạng thái kết nối.
   */
  async getTokenInfo(
    userId: string,
  ): Promise<{ connected: boolean; email?: string; connectedAt?: Date }> {
    const tokenDoc = await this.tokenModel
      .findOne({ userId })
      .select('email createdAt')
      .lean()
      .exec();

    if (!tokenDoc) {
      return { connected: false };
    }

    // createdAt đến từ timestamps: true — Lean document type không include
    // timestamp fields, nên cast qua unknown.
    const createdAt = (tokenDoc as unknown as { createdAt?: Date }).createdAt;

    return {
      connected: true,
      email: tokenDoc.email ?? undefined,
      connectedAt: createdAt,
    };
  }

  /**
   * Sign state parameter: userId:nonce:hmacSignature.
   */
  private signState(userId: string): string {
    const nonce = randomBytes(16).toString('hex');
    const signature = this.computeSignature(userId, nonce);
    return `${userId}:${nonce}:${signature}`;
  }

  /**
   * Compute HMAC-SHA256 signature for userId:nonce.
   */
  private computeSignature(userId: string, nonce: string): string {
    const secret =
      this.configService.get<string>('GOOGLE_OAUTH_STATE_SECRET') ||
      this.configService.get<string>('GOOGLE_CLIENT_SECRET') ||
      'fallback-state-secret';
    return createHmac('sha256', secret)
      .update(`${userId}:${nonce}`)
      .digest('hex');
  }

  /**
   * Tạo base OAuth2Client từ env vars.
   * KHÔNG setCredentials — caller chịu trách nhiệm.
   */
  private createBaseOAuth2Client(): OAuth2Client {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'GOOGLE_CLIENT_SECRET',
    );
    const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI');

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks on HMAC verification.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
