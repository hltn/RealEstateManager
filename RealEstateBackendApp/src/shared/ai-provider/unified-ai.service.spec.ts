import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalLogService } from '../../modules/external-log/services/external-log.service';
import { UnifiedAiService, CallAiOptions } from './unified-ai.service';

/**
 * Unit test cho UnifiedAiService — resolve provider (Must1c / 9Router) và
 * callChatCompletion (mock global.fetch từng test, khôi phục ở afterEach).
 */
describe('UnifiedAiService', () => {
  let service: UnifiedAiService;
  let mockConfigService: any;
  let mockExternalLogService: any;

  // Service có fallback `configService.get(...) || process.env.*`. Gỡ các env AI
  // trong scope test để kết quả deterministic (CI có thể load .env), restore ở afterEach.
  const ENV_KEYS = [
    'ACTIVE_AI_PLATFORM',
    'MUST1C_API_KEY',
    'MUST1C_MODEL',
    'MUST1C_API_URL',
    'NINEROUTER_API_KEY',
    'NINEROUTER_BASE_URL',
    'NINEROUTER_MODEL',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  const originalFetch = global.fetch;

  const MUST1C_PROVIDER = {
    name: 'Must1c',
    url: 'https://htmustc.id.vn/v1/chat/completions',
    apiKey: 'm1c-key',
    model: 'gemini-3.6-flash',
  };

  const payload = {
    model: 'gemini-3.6-flash',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const buildOptions = (signal?: AbortSignal): CallAiOptions => ({
    provider: MUST1C_PROVIDER,
    contextLabel: 'test',
    prompt: 'Hello',
    signal: signal ?? new AbortController().signal,
  });

  // Helper: kiểm tra ném BadRequestException đúng message (toThrow chỉ nhận 1 đối số).
  const expectBadRequest = (fn: () => unknown, message: string) => {
    expect(fn).toThrow(BadRequestException);
    expect(fn).toThrow(message);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }

    mockConfigService = {
      get: jest.fn((key: string) => {
        const cfg: Record<string, string | undefined> = {
          ACTIVE_AI_PLATFORM: 'Must1c',
          MUST1C_API_KEY: 'm1c-key',
          MUST1C_MODEL: 'gemini-3.6-flash',
          MUST1C_API_URL: 'https://htmustc.id.vn/v1/chat/completions',
        };
        return cfg[key];
      }),
    };

    mockExternalLogService = {
      logAi: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnifiedAiService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ExternalLogService, useValue: mockExternalLogService },
      ],
    }).compile();

    service = module.get<UnifiedAiService>(UnifiedAiService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k] as string;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveProvider', () => {
    it('should resolve Must1c provider when configured', () => {
      expect(service.resolveProvider()).toEqual(MUST1C_PROVIDER);
    });

    it('should resolve 9Router provider and strip trailing slash of base URL', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        const cfg: Record<string, string | undefined> = {
          ACTIVE_AI_PLATFORM: '9Router',
          NINEROUTER_API_KEY: 'nr-key',
          NINEROUTER_BASE_URL: 'http://router.local/v1/',
          NINEROUTER_MODEL: 'router-model',
        };
        return cfg[key];
      });

      expect(service.resolveProvider()).toEqual({
        name: '9Router',
        url: 'http://router.local/v1/chat/completions',
        apiKey: 'nr-key',
        model: 'router-model',
      });
    });

    it('should throw when no AI platform is configured', () => {
      mockConfigService.get.mockReturnValue(undefined);

      expectBadRequest(
        () => service.resolveProvider(),
        'No AI platform configured. Set ACTIVE_AI_PLATFORM to "Must1c" or "9Router".',
      );
    });

    it('should throw when unsupported AI platform is configured', () => {
      mockConfigService.get.mockReturnValue('UnsupportedPlatform');

      expectBadRequest(
        () => service.resolveProvider(),
        'Unsupported AI platform "UnsupportedPlatform". Only "Must1c" and "9Router" are supported.',
      );
    });

    it('should throw when Must1c API key is missing', () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'ACTIVE_AI_PLATFORM' ? 'Must1c' : undefined,
      );

      expectBadRequest(
        () => service.resolveProvider(),
        'Must1c API key not configured. Set MUST1C_API_KEY environment variable.',
      );
    });
  });

  describe('resolveFromConfig', () => {
    it('should resolve from external config with Must1c provider', () => {
      const result = service.resolveFromConfig({
        provider: 'Must1c',
        model: 'custom-model',
        apiKey: 'custom-key',
      });

      expect(result).toEqual({
        name: 'Must1c',
        url: 'https://htmustc.id.vn/v1/chat/completions',
        apiKey: 'custom-key',
        model: 'custom-model',
      });
    });

    it('should fall back to ConfigService values when external config has no model/key', () => {
      const result = service.resolveFromConfig({ provider: 'Must1c' });

      expect(result.name).toBe('Must1c');
      expect(result.apiKey).toBe('m1c-key');
      expect(result.model).toBe('gemini-3.6-flash');
    });

    it('should resolve 9Router from external config (case-insensitive provider, custom baseUrl)', () => {
      const result = service.resolveFromConfig({
        provider: '9ROUTER',
        baseUrl: 'http://custom/v1//',
        apiKey: 'nr-key',
        model: 'nr-model',
      });

      expect(result).toEqual({
        name: '9Router',
        url: 'http://custom/v1/chat/completions',
        apiKey: 'nr-key',
        model: 'nr-model',
      });
    });

    it('should throw when unsupported provider in external config', () => {
      expectBadRequest(
        () => service.resolveFromConfig({ provider: 'UnsupportedProvider' }),
        'Unsupported AI provider "UnsupportedProvider". Only "Must1c" and "9Router" are supported.',
      );
    });
  });

  describe('httpErrorDescription', () => {
    it('should return error description for known status codes', () => {
      expect(service.httpErrorDescription(401)).toBe(
        'Invalid API key (authentication_error)',
      );
      expect(service.httpErrorDescription(429)).toBe(
        'Rate limit exceeded (rate_limit_error)',
      );
      expect(service.httpErrorDescription(500)).toBe(
        'Internal gateway/upstream error (api_error)',
      );
    });

    it('should return generic description for unknown status codes', () => {
      expect(service.httpErrorDescription(999)).toBe(
        'Unexpected error (HTTP 999)',
      );
    });
  });

  describe('callChatCompletion', () => {
    it('should POST to provider URL and log response with usage', async () => {
      const body = {
        choices: [{ message: { content: 'test response' } }],
        usage: { total_tokens: 10 },
      };
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: () => Promise.resolve(JSON.stringify(body)) }),
      };
      const fetchMock = jest.fn().mockResolvedValue(mockResponse);
      global.fetch = fetchMock as any;

      const result = await service.callChatCompletion(payload, buildOptions());

      expect(result).toBe(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        MUST1C_PROVIDER.url,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer m1c-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ ...payload, stream: false }),
        }),
      );
      expect(mockExternalLogService.logAi).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'Must1c',
          statusCode: 200,
          responseBody: body,
          usage: body.usage,
          metadata: { contextLabel: 'test' },
        }),
      );
    });

    it('should return non-ok response without throwing and log raw body', async () => {
      // callChatCompletion không ném lỗi HTTP — caller tự xử lý res.ok.
      const errBody = '{"error": {"message": "Invalid key"}}';
      const mockResponse = {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: () => Promise.resolve(errBody) }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse) as any;

      const result = await service.callChatCompletion(payload, buildOptions());

      expect(result.ok).toBe(false);
      expect(mockExternalLogService.logAi).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, responseBody: errBody }),
      );
    });

    it('should log AbortError and rethrow when request is aborted', async () => {
      // Mock fetch reject khi signal bị abort (giống hành vi fetch thật).
      global.fetch = jest.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(
                Object.assign(new Error('The user aborted a request'), {
                  name: 'AbortError',
                }),
              );
            });
          }),
      ) as any;

      const controller = new AbortController();
      const pending = service.callChatCompletion(
        payload,
        buildOptions(controller.signal),
      );
      controller.abort();

      await expect(pending).rejects.toThrow('The user aborted a request');
      expect(mockExternalLogService.logAi).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AbortError' }),
        }),
      );
    });

    it('should log network error and rethrow', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('network down')) as any;

      await expect(
        service.callChatCompletion(payload, buildOptions()),
      ).rejects.toThrow('network down');
      expect(mockExternalLogService.logAi).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'network down' }),
        }),
      );
    });
  });
});
