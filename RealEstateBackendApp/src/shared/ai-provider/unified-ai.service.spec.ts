import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExternalLogService } from '../../modules/external-log/services/external-log.service';
import { UnifiedAiService } from './unified-ai.service';
import { ConfigService } from '@nestjs/config';

// Mock fetch for testing
jest.mock('fetch');

describe('UnifiedAiService', () => {
  let service: UnifiedAiService;
  let mockConfigService: any;
  let mockExternalLogService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveProvider', () => {
    it('should resolve Must1c provider when configured', () => {
      const result = service.resolveProvider();
      expect(result).toEqual({
        name: 'Must1c',
        url: 'https://htmustc.id.vn/v1/chat/completions',
        apiKey: 'm1c-key',
        model: 'gemini-3.6-flash',
      });
    });

    it('should throw when no AI platform is configured', () => {
      mockConfigService.get.mockReturnValue(undefined);
      
      expect(() => service.resolveProvider()).toThrow(
        BadRequestException,
        'No AI platform configured. Set ACTIVE_AI_PLATFORM to "Must1c" or "9Router".'
      );
    });

    it('should throw when unsupported AI platform is configured', () => {
      mockConfigService.get.mockReturnValue('UnsupportedPlatform');
      
      expect(() => service.resolveProvider()).toThrow(
        BadRequestException,
        'Unsupported AI platform "UnsupportedPlatform". Only "Must1c" and "9Router" are supported.'
      );
    });

    it('should throw when Must1c API key is missing', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'MUST1C_API_KEY') return undefined;
        return 'Must1c';
      });
      
      expect(() => service.resolveProvider()).toThrow(
        BadRequestException,
        'Must1c API key not configured. Set MUST1C_API_KEY environment variable.'
      );
    });
  });

  describe('resolveFromConfig', () => {
    it('should resolve from external config with Must1c provider', () => {
      const config = {
        provider: 'Must1c',
        model: 'custom-model',
        apiKey: 'custom-key',
      };
      
      const result = service.resolveFromConfig(config);
      expect(result).toEqual({
        name: 'Must1c',
        url: 'https://htmustc.id.vn/v1/chat/completions',
        apiKey: 'custom-key',
        model: 'custom-model',
      });
    });

    it('should resolve from external config with defaults', () => {
      const config = {
        provider: 'Must1c',
      };
      
      const result = service.resolveFromConfig(config);
      expect(result.name).toBe('Must1c');
      expect(result.apiKey).toBe('m1c-key');
      expect(result.model).toBe('gemini-3.6-flash');
    });

    it('should throw when unsupported provider in external config', () => {
      const config = {
        provider: 'UnsupportedProvider',
      };
      
      expect(() => service.resolveFromConfig(config)).toThrow(
        BadRequestException,
        'Unsupported AI provider "UnsupportedProvider". Only "Must1c" and "9Router" are supported.'
      );
    });
  });

  describe('httpErrorDescription', () => {
    it('should return error description for known status codes', () => {
      expect(service.httpErrorDescription(401)).toBe('Invalid API key (authentication_error)');
      expect(service.httpErrorDescription(429)).toBe('Rate limit exceeded (rate_limit_error)');
      expect(service.httpErrorDescription(500)).toBe('Internal gateway/upstream error (api_error)');
    });

    it('should return generic description for unknown status codes', () => {
      expect(service.httpErrorDescription(999)).toBe('Unexpected error (HTTP 999)');
    });
  });

  describe('callChatCompletion', () => {
    it('should make API call and log response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({
          text: () => Promise.resolve('{"choices": [{"message": {"content": "test response"}}]}'),
        }),
      };

      // @ts-ignore - Mock fetch function
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await service.callChatCompletion(
        {
          model: 'gemini-3.6-flash',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        {
          provider: {
            name: 'Must1c',
            url: 'https://htmustc.id.vn/v1/chat/completions',
            apiKey: 'm1c-key',
            model: 'gemini-3.6-flash',
          },
          contextLabel: 'test',
          prompt: 'Hello',
          signal: new AbortController().signal,
        }
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://htmustc.id.vn/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer m1c-key',
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(mockExternalLogService.logAi).toHaveBeenCalled();
    });

    it('should handle API errors and log them', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({
          text: () => Promise.resolve('{"error": {"message": "Invalid key"}}'),
        }),
      };

      // @ts-ignore - Mock fetch function
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      await expect(
        service.callChatCompletion(
          {
            model: 'gemini-3.6-flash',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          {
            provider: {
              name: 'Must1c',
              url: 'https://htmustc.id.vn/v1/chat/completions',
              apiKey: 'm1c-key',
              model: 'gemini-3.6-flash',
            },
            contextLabel: 'test',
            prompt: 'Hello',
            signal: new AbortController().signal,
          }
        )
      ).rejects.toThrow();

      expect(mockExternalLogService.logAi).toHaveBeenCalled();
    });

    it('should handle request timeout and log', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({
          text: () => Promise.resolve('{"choices": [{"message": {"content": "test"}}]}'),
        }),
      };

      // @ts-ignore - Mock fetch function
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const signal = new AbortController().signal;
      setTimeout(() => signal.abort(), 100);

      await expect(
        service.callChatCompletion(
          {
            model: 'gemini-3.6-flash',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          {
            provider: {
              name: 'Must1c',
              url: 'https://htmustc.id.vn/v1/chat/completions',
              apiKey: 'm1c-key',
              model: 'gemini-3.6-flash',
            },
            contextLabel: 'test',
            prompt: 'Hello',
            signal,
          }
        )
      ).rejects.toThrow('The user aborted a request');
    });
  });
});