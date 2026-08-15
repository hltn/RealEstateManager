/**
 * GoogleDriveOAuthService unit spec.
 *
 * Bao phủ:
 * - generateAuthUrl: tạo URL với scope drive.file, state=signed(userId:nonce:signature)
 * - validateOAuthState: verify HMAC signature, extract userId
 * - exchangeCode: exchange code → get tokens → get email → upsert DB
 * - getOAuth2Client: load token → create OAuth2Client → once('tokens') for auto-refresh
 * - revokeAndDelete: revoke on Google → delete from DB
 * - getTokenInfo: lookup token → return status
 *
 * Mock: googleapis — OAuth2 mock instance chia sẻ giữa mock constructor và service.
 * Mock: node:crypto — deterministic randomBytes + createHmac.
 */
const mockOAuth2Instance: any = {
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
  setCredentials: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  revokeCredentials: jest.fn(),
};

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn(() => mockOAuth2Instance),
    },
    oauth2: jest.fn(() => ({
      userinfo: {
        get: jest.fn().mockResolvedValue({ data: { email: 'user@gmail.com' } }),
      },
    })),
  },
}));

/**
 * Track the last HMAC digest to allow tests to override for signature mismatch scenarios.
 */
let lastHmacDigest = 'test-signature';

jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto');
  return {
    ...actual,
    randomBytes: jest.fn(() => Buffer.from('test-nonce-16-bytes!')),
    createHmac: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn(() => lastHmacDigest),
    })),
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleDriveOAuthService } from './google-drive-oauth.service';
import { GoogleDriveToken } from '../schemas/google-drive-token.schema';

function chainable(finalValue: unknown = undefined): any {
  const chain: any = {};
  const chainFn = () => chain;
  for (const m of ['select', 'lean', 'sort', 'skip', 'limit', 'populate']) {
    chain[m] = jest.fn(chainFn);
  }
  chain.exec = jest.fn(async () => finalValue);
  return chain;
}

const USER_ID = '65e1f0a1b2c3d4e5f6a7b8c9';
const TOKEN_DOC = {
  userId: USER_ID,
  accessToken: 'ya29.access-token',
  refreshToken: '1//0.refresh-token',
  expiresAt: new Date('2026-08-16T10:00:00.000Z'),
  email: 'user@gmail.com',
  scope: 'https://www.googleapis.com/auth/drive.file',
  createdAt: new Date('2026-08-15T10:00:00.000Z'),
};

describe('GoogleDriveOAuthService', () => {
  let service: GoogleDriveOAuthService;
  let tokenModel: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset tracking variable
    lastHmacDigest = 'test-signature';
    // Reset shared mock instance.
    mockOAuth2Instance.generateAuthUrl.mockReset();
    mockOAuth2Instance.getToken.mockReset();
    mockOAuth2Instance.setCredentials.mockReset();
    mockOAuth2Instance.on.mockReset();
    mockOAuth2Instance.once.mockReset();
    mockOAuth2Instance.revokeCredentials.mockReset();

    tokenModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) => {
        const vars: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'test-client-id',
          GOOGLE_CLIENT_SECRET: 'test-client-secret',
          GOOGLE_REDIRECT_URI:
            'http://localhost:3000/api/v1/google-drive/auth/callback',
          GOOGLE_OAUTH_STATE_SECRET: 'test-state-secret',
        };
        return vars[key] ?? '';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveOAuthService,
        {
          provide: getModelToken(GoogleDriveToken.name),
          useValue: tokenModel,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<GoogleDriveOAuthService>(GoogleDriveOAuthService);
  });

  describe('generateAuthUrl', () => {
    it('creates OAuth2 URL with drive.file scope and signed state', () => {
      const expectedUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?...';
      mockOAuth2Instance.generateAuthUrl.mockReturnValue(expectedUrl);

      const url = service.generateAuthUrl(USER_ID);

      expect(url).toBe(expectedUrl);
      expect(mockOAuth2Instance.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          prompt: 'consent',
          scope: ['https://www.googleapis.com/auth/drive.file'],
          // M-02: state is now signed format userId:nonce:signature
          state: expect.stringContaining(`${USER_ID}:`),
        }),
      );
    });

    it('generates state in userId:nonce:signature format', () => {
      const expectedUrl = 'https://accounts.google.com/o/oauth2/v2/auth?...';
      mockOAuth2Instance.generateAuthUrl.mockReturnValue(expectedUrl);

      service.generateAuthUrl(USER_ID);

      const callArg = mockOAuth2Instance.generateAuthUrl.mock.calls[0][0];
      const stateParts = callArg.state.split(':');
      expect(stateParts).toHaveLength(3);
      expect(stateParts[0]).toBe(USER_ID);
      expect(stateParts[1]).toBeTruthy(); // nonce
      expect(stateParts[2]).toBeTruthy(); // signature
    });
  });

  describe('validateOAuthState', () => {
    it('returns userId when state is valid', () => {
      const state = `${USER_ID}:abc123:test-signature`;
      const userId = service.validateOAuthState(state);
      expect(userId).toBe(USER_ID);
    });

    it('throws UnauthorizedException when state is empty', () => {
      expect(() => service.validateOAuthState('')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when state has wrong format', () => {
      expect(() => service.validateOAuthState('invalid-state')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when signature does not match', () => {
      // Override the digest to simulate a wrong signature
      lastHmacDigest = 'expected-correct-signature';
      const state = `${USER_ID}:abc123:wrong-signature`;
      expect(() => service.validateOAuthState(state)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('exchangeCode', () => {
    const mockTokens = {
      access_token: 'ya29.new-access',
      refresh_token: '1//0.new-refresh',
      expiry_date: Date.now() + 3600_000,
      scope: 'https://www.googleapis.com/auth/drive.file',
    };

    beforeEach(() => {
      mockOAuth2Instance.getToken.mockResolvedValue({ tokens: mockTokens });
      mockOAuth2Instance.setCredentials.mockImplementation(() => {});
      tokenModel.findOneAndUpdate.mockReturnValue(
        chainable({ userId: USER_ID }),
      );
    });

    it('exchanges code, gets email, upserts token to DB', async () => {
      const result = await service.exchangeCode('auth-code-123', USER_ID);

      expect(result.userId).toBe(USER_ID);
      expect(result.email).toBe('user@gmail.com');
      expect(result.accessToken).toBe('ya29.new-access');
      expect(result.refreshToken).toBe('1//0.new-refresh');
      expect(tokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: USER_ID },
        expect.objectContaining({
          $set: expect.objectContaining({
            userId: USER_ID,
            accessToken: 'ya29.new-access',
            refreshToken: '1//0.new-refresh',
            email: 'user@gmail.com',
          }),
        }),
        { upsert: true, new: true },
      );
    });

    it('throws UnauthorizedException when tokens are missing', async () => {
      mockOAuth2Instance.getToken.mockResolvedValue({
        tokens: { access_token: null, refresh_token: null },
      });

      await expect(
        service.exchangeCode('bad-code', USER_ID),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.exchangeCode('bad-code', USER_ID),
      ).rejects.toThrow('Failed to obtain tokens from Google');
    });
  });

  describe('getOAuth2Client', () => {
    it('throws UnauthorizedException when no token found', async () => {
      tokenModel.findOne.mockReturnValue(chainable(null));

      await expect(service.getOAuth2Client(USER_ID)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.getOAuth2Client(USER_ID)).rejects.toThrow(
        'Google Drive not connected',
      );
    });

    it('creates OAuth2Client with credentials from DB', async () => {
      tokenModel.findOne.mockReturnValue(chainable(TOKEN_DOC));

      const client = await service.getOAuth2Client(USER_ID);

      expect(client).toBeDefined();
      expect(mockOAuth2Instance.setCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: TOKEN_DOC.accessToken,
          refresh_token: TOKEN_DOC.refreshToken,
        }),
      );
    });

    it('registers tokens event listener with once() to prevent leak (M-03)', async () => {
      tokenModel.findOne.mockReturnValue(chainable(TOKEN_DOC));

      await service.getOAuth2Client(USER_ID);

      // M-03 fix: should use 'once' not 'on'
      expect(mockOAuth2Instance.once).toHaveBeenCalledWith(
        'tokens',
        expect.any(Function),
      );
      expect(mockOAuth2Instance.on).not.toHaveBeenCalled();
    });
  });

  describe('revokeAndDelete', () => {
    it('revokes on Google then deletes from DB', async () => {
      tokenModel.findOne.mockReturnValue(chainable(TOKEN_DOC));
      mockOAuth2Instance.revokeCredentials.mockResolvedValue({});
      tokenModel.deleteOne.mockReturnValue(chainable(undefined));

      await service.revokeAndDelete(USER_ID);

      expect(mockOAuth2Instance.revokeCredentials).toHaveBeenCalled();
      expect(tokenModel.deleteOne).toHaveBeenCalledWith({
        userId: USER_ID,
      });
    });

    it('throws UnauthorizedException when no token found', async () => {
      tokenModel.findOne.mockReturnValue(chainable(null));

      await expect(service.revokeAndDelete(USER_ID)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.revokeAndDelete(USER_ID)).rejects.toThrow(
        'Google Drive not connected',
      );
    });

    it('deletes from DB even if revoke fails (idempotent)', async () => {
      tokenModel.findOne.mockReturnValue(chainable(TOKEN_DOC));
      mockOAuth2Instance.revokeCredentials.mockRejectedValue(
        new Error('Already revoked'),
      );
      tokenModel.deleteOne.mockReturnValue(chainable(undefined));

      // Should NOT throw — revoke failure is caught and logged.
      await service.revokeAndDelete(USER_ID);

      expect(tokenModel.deleteOne).toHaveBeenCalledWith({
        userId: USER_ID,
      });
    });
  });

  describe('getTokenInfo', () => {
    it('returns connected=false when no token found', async () => {
      tokenModel.findOne.mockReturnValue(chainable(null));

      const result = await service.getTokenInfo(USER_ID);

      expect(result).toEqual({ connected: false });
    });

    it('returns connected=true with email and createdAt', async () => {
      tokenModel.findOne.mockReturnValue(chainable(TOKEN_DOC));

      const result = await service.getTokenInfo(USER_ID);

      expect(result).toEqual({
        connected: true,
        email: 'user@gmail.com',
        connectedAt: TOKEN_DOC.createdAt,
      });
      // Verify select('email createdAt') was called.
      expect(tokenModel.findOne().select).toHaveBeenCalledWith(
        'email createdAt',
      );
    });
  });
});
