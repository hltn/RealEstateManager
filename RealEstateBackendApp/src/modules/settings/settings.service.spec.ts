/**
 * SettingsService unit spec — contract mục 3 (Swagger/AI config) + bảo mật:
 * mask API key thành '***' khi trả về FE (mục 1 — Least Privilege Data).
 *
 * Bao phủ:
 * - getAiConfig: fallback default + mask apiKey/must1cApiKey.
 * - updateAiConfig: ghi .env, replace dòng có sẵn, append dòng mới, skip '***'.
 * - updateAiConfig: cập nhật process.env song song.
 * - getOpenRouterModels: thiếu key → throw; fetch ok → trả data; fetch fail → throw.
 *
 * Mock: ConfigService, fs (existsSync/readFileSync/writeFileSync), global.fetch.
 */
jest.mock('fs');
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from './settings.service';

describe('SettingsService (contract mục 3 + bảo mật Least Privilege)', () => {
  let service: SettingsService;
  let configService: jest.Mocked<ConfigService>;
  const existsSpy = fs.existsSync as unknown as jest.Mock;
  const readSpy = fs.readFileSync as unknown as jest.Mock;
  const writeSpy = fs.writeFileSync as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
    service = new SettingsService(configService);
  });

  describe('getAiConfig — mask key + default', () => {
    it('mask apiKey thành "***" khi có key (Least Privilege Data — mục 1)', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'sk-real-key';
        if (key === 'MUST1C_API_KEY') return 'must-real';
        if (key === 'OPENROUTER_AI_PROVIDER') return 'OpenRouter';
        if (key === 'OPENROUTER_AI_MODEL') return 'google/x';
        if (key === 'MUST1C_MODEL') return 'm-model';
        if (key === 'ACTIVE_AI_PLATFORM') return 'OpenRouter';
        return undefined;
      });

      const cfg = service.getAiConfig();

      expect(cfg.apiKey).toBe('***');
      expect(cfg.must1cApiKey).toBe('***');
      expect(cfg.provider).toBe('OpenRouter');
      expect(cfg.model).toBe('google/x');
      expect(cfg.must1cModel).toBe('m-model');
      expect(cfg.activePlatform).toBe('OpenRouter');
    });

    it('apiKey rỗng khi thiếu key (trả "" thay vì leak undefined)', () => {
      configService.get.mockReturnValue(undefined);
      // process.env cũng rỗng
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.MUST1C_API_KEY;

      const cfg = service.getAiConfig();

      expect(cfg.apiKey).toBe('');
      expect(cfg.must1cApiKey).toBe('');
      // Default provider/model/activePlatform.
      expect(cfg.provider).toBe('OpenRouter');
      expect(cfg.model).toBe('google/gemini-2.5-flash');
      expect(cfg.activePlatform).toBe('OpenRouter');
    });

    it('fallback sang process.env khi ConfigService trả undefined', () => {
      configService.get.mockReturnValue(undefined);
      process.env.OPENROUTER_API_KEY = 'env-or-key';
      process.env.OPENROUTER_AI_PROVIDER = 'envProvider';
      process.env.OPENROUTER_AI_MODEL = 'env-model';
      process.env.ACTIVE_AI_PLATFORM = 'envPlatform';

      const cfg = service.getAiConfig();

      expect(cfg.apiKey).toBe('***');
      expect(cfg.provider).toBe('envProvider');
      expect(cfg.model).toBe('env-model');
      expect(cfg.activePlatform).toBe('envPlatform');

      // cleanup
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_AI_PROVIDER;
      delete process.env.OPENROUTER_AI_MODEL;
      delete process.env.ACTIVE_AI_PLATFORM;
    });
  });

  describe('updateAiConfig — ghi .env', () => {
    it('file chưa có → create + append key mới + set process.env', () => {
      existsSpy.mockReturnValue(false);
      const captured: string[] = [];
      writeSpy.mockImplementation((_p: string, content: string) => {
        captured.push(content);
      });

      const result = service.updateAiConfig({
        provider: 'OpenRouter',
        model: 'gpt-4',
        apiKey: 'sk-new',
      });

      expect(result).toEqual({ success: true });
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const content = captured[0];
      expect(content).toContain('OPENROUTER_AI_PROVIDER=OpenRouter');
      expect(content).toContain('OPENROUTER_AI_MODEL=gpt-4');
      expect(content).toContain('OPENROUTER_API_KEY=sk-new');
      // process.env được set song song để reload tức thì.
      expect(process.env.OPENROUTER_AI_PROVIDER).toBe('OpenRouter');
      expect(process.env.OPENROUTER_AI_MODEL).toBe('gpt-4');
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-new');

      delete process.env.OPENROUTER_AI_PROVIDER;
      delete process.env.OPENROUTER_AI_MODEL;
      delete process.env.OPENROUTER_API_KEY;
    });

    it('file có sẵn dòng → replace bằng regex, KHÔNG append duplicate', () => {
      existsSpy.mockReturnValue(true);
      readSpy.mockReturnValue(
        'OPENROUTER_AI_PROVIDER=old\nOPENROUTER_API_KEY=old-key\n',
      );
      const captured: string[] = [];
      writeSpy.mockImplementation((_p: string, content: string) => {
        captured.push(content);
      });

      service.updateAiConfig({ provider: 'new', apiKey: 'new-key' });

      const content = captured[0];
      // Chỉ 1 dòng OPENROUTER_AI_PROVIDER, đã replace.
      const lines = content.split('\n').filter((l) => l.startsWith('OPENROUTER_AI_PROVIDER='));
      expect(lines).toEqual(['OPENROUTER_AI_PROVIDER=new']);
      expect(content).toContain('OPENROUTER_API_KEY=new-key');
      expect(content).not.toContain('old-key');
      expect(content).not.toContain('OPENROUTER_AI_PROVIDER=old');
    });

    it('apiKey="***" → KHÔNG overwrite key thật (sentinel chống ghi nhầm)', () => {
      existsSpy.mockReturnValue(true);
      readSpy.mockReturnValue('OPENROUTER_API_KEY=sk-real\n');
      // Baseline: env đã có key thật — sentinel không được ghi đè.
      process.env.OPENROUTER_API_KEY = 'sk-real';

      service.updateAiConfig({ apiKey: '***' });

      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toContain('OPENROUTER_API_KEY=sk-real');
      // Không ghi đè bằng "***".
      expect(content).not.toContain('OPENROUTER_API_KEY=***');
      // process.env KHÔNG bị thay đổi (sentinel skip cả file lẫn env).
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-real');

      delete process.env.OPENROUTER_API_KEY;
    });

    it('must1cApiKey="***" → skip update (giữ key cũ)', () => {
      existsSpy.mockReturnValue(true);
      readSpy.mockReturnValue('MUST1C_API_KEY=m-old\n');

      service.updateAiConfig({ must1cApiKey: '***' });

      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toContain('MUST1C_API_KEY=m-old');

      delete process.env.MUST1C_API_KEY;
    });

    it('field undefined → skip, không tạo entry mới', () => {
      existsSpy.mockReturnValue(true);
      readSpy.mockReturnValue('OPENROUTER_AI_PROVIDER=keep\n');

      service.updateAiConfig({});

      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toBe('OPENROUTER_AI_PROVIDER=keep\n');
    });

    it('file tồn tại nhưng không kết thúc newline → append thêm newline trước khi thêm key mới', () => {
      existsSpy.mockReturnValue(true);
      readSpy.mockReturnValue('OPENROUTER_AI_PROVIDER=old'); // no trailing newline

      service.updateAiConfig({ model: 'm1' });

      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toContain('OPENROUTER_AI_PROVIDER=old\n');
      expect(content).toContain('OPENROUTER_AI_MODEL=m1\n');
    });
  });

  describe('getOpenRouterModels', () => {
    afterEach(() => {
      delete process.env.OPENROUTER_API_KEY;
    });

    it('thiếu API key → throw "OpenRouter API key is not configured"', async () => {
      configService.get.mockReturnValue(undefined);
      delete process.env.OPENROUTER_API_KEY;

      await expect(service.getOpenRouterModels()).rejects.toThrow(
        'OpenRouter API key is not configured',
      );
    });

    it('fetch thành công → trả JSON data với Bearer apiKey', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'sk-or';
        return undefined;
      });
      const jsonMock = jest.fn().mockResolvedValue({ data: [{ id: 'gpt' }] });
      (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: jsonMock,
      });

      const result = await service.getOpenRouterModels();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-or',
          }),
        }),
      );
      expect(result).toEqual({ data: [{ id: 'gpt' }] });
      expect(jsonMock).toHaveBeenCalled();
    });

    it('fetch trả !ok → throw với statusText', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'sk-or';
        return undefined;
      });
      (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: jest.fn(),
      });

      await expect(service.getOpenRouterModels()).rejects.toThrow(
        'Failed to fetch models: Unauthorized',
      );
    });

    it('fetch ném network error → re-throw nguyên lỗi sau khi log', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'sk-or';
        return undefined;
      });
      (global.fetch as unknown as jest.Mock) = jest.fn().mockRejectedValue(
        new Error('network down'),
      );

      await expect(service.getOpenRouterModels()).rejects.toThrow(
        'network down',
      );
    });

    it('fetch treo quá 5s → throw timeout (AbortController abort)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'sk-or';
        return undefined;
      });
      // Fetch ném AbortError khi signal abort.
      (global.fetch as unknown as jest.Mock) = jest
        .fn()
        .mockImplementation((_url: string, init: RequestInit) =>
          Promise.reject(
            Object.assign(new Error('The operation was aborted'), {
              name: 'AbortError',
            }),
          ),
        );

      await expect(service.getOpenRouterModels()).rejects.toThrow(
        /timed out after 5s/i,
      );
    });
  });
});
