/**
 * SettingsService unit spec — contract mục 3 (Swagger/AI config) + bảo mật:
 * mask API key thành '***' khi trả về FE (mục 1 — Least Privilege Data).
 *
 * Bao phủ:
 * - getAiConfig: fallback default + mask apiKey/must1cApiKey.
 * - updateAiConfig: lưu bền vào file riêng SETTINGS_CONFIG_FILE (không phải .env), thay khóa có sẵn, skip '***',
 *   chống xuống dòng, không rò API key vào log, nạp lại được lúc khởi động.
 * - updateAiConfig: cập nhật process.env song song (chỉ sau khi ghi file thành công).
 * - getOpenRouterModels: thiếu key → throw; fetch ok → trả data; fetch fail → throw.
 *
 * Mock: ConfigService, global.fetch. Phần lưu file dùng file THẬT trong thư mục tạm.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_CONFIG_KEYS,
  applySettingsConfigFile,
  readSettingsConfigFile,
  SettingsEnvTarget,
} from '../../common/config/settings-config-file';
import { SettingsService } from './settings.service';

describe('SettingsService (contract mục 3 + bảo mật Least Privilege)', () => {
  let service: SettingsService;
  let configService: jest.Mocked<ConfigService>;

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
        if (key === 'NINEROUTER_API_KEY') return 'nine-router-real';
        if (key === 'ACTIVE_AI_PLATFORM') return 'OpenRouter';
        return undefined;
      });

      const cfg = service.getAiConfig();

      expect(cfg.apiKey).toBe('***');
      expect(cfg.must1cApiKey).toBe('***');
      expect(cfg.provider).toBe('OpenRouter');
      expect(cfg.model).toBe('google/x');
      expect(cfg.must1cModel).toBe('m-model');
      expect(cfg.nineRouterBaseUrl).toBe('http://127.0.0.1:20128/v1');
      expect(cfg.nineRouterApiKey).toBe('***');
      expect(cfg.nineRouterModel).toBe('');
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
      expect(cfg.nineRouterBaseUrl).toBe('http://127.0.0.1:20128/v1');
      expect(cfg.nineRouterApiKey).toBe('');
      expect(cfg.nineRouterModel).toBe('');
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

  describe('updateAiConfig — lưu bền vào file riêng (SETTINGS_CONFIG_FILE)', () => {
    const SECRET = 'sk-SECRET-NEVER-LOG-ME';
    let sandbox: string;
    let savedPath: string;
    let envPath: string;
    const touchedKeys = [...AI_CONFIG_KEYS, 'SETTINGS_CONFIG_FILE'];
    const savedEnv: Record<string, string | undefined> = {};
    const originalCwd = process.cwd();

    beforeEach(() => {
      sandbox = mkdtempSync(join(tmpdir(), 'settings-service-'));
      savedPath = join(sandbox, 'state', 'ai.env');
      envPath = join(sandbox, '.env');
      for (const key of touchedKeys) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      process.env.SETTINGS_CONFIG_FILE = savedPath;
    });

    afterEach(() => {
      process.chdir(originalCwd);
      rmSync(sandbox, { recursive: true, force: true });
      for (const key of touchedKeys) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it('file chưa có → tạo file (cả thư mục cha) + ghi khóa mới + set process.env', () => {
      const result = service.updateAiConfig({
        provider: 'OpenRouter',
        model: 'gpt-4',
        apiKey: 'sk-new',
        nineRouterBaseUrl: 'http://custom-9router:20128/v1',
        nineRouterApiKey: 'sk-9router-key',
        nineRouterModel: 'meta/llama-3-70b-instruct',
      });

      expect(result).toEqual({ success: true });
      expect(readSettingsConfigFile(savedPath)).toEqual({
        OPENROUTER_AI_PROVIDER: 'OpenRouter',
        OPENROUTER_AI_MODEL: 'gpt-4',
        OPENROUTER_API_KEY: 'sk-new',
        NINEROUTER_BASE_URL: 'http://custom-9router:20128/v1',
        NINEROUTER_API_KEY: 'sk-9router-key',
        NINEROUTER_MODEL: 'meta/llama-3-70b-instruct',
      });
      // process.env được set song song để reload tức thì.
      expect(process.env.OPENROUTER_AI_PROVIDER).toBe('OpenRouter');
      expect(process.env.OPENROUTER_AI_MODEL).toBe('gpt-4');
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-new');
    });

    it('ghi đủ 9 khóa allowlist khi gửi đủ mọi trường', () => {
      service.updateAiConfig({
        provider: 'p',
        model: 'm',
        apiKey: 'k1',
        must1cApiKey: 'k2',
        must1cModel: 'mm',
        nineRouterBaseUrl: 'http://x/v1',
        nineRouterApiKey: 'k3',
        nineRouterModel: 'nm',
        activePlatform: '9Router',
      });

      expect(Object.keys(readSettingsConfigFile(savedPath)).sort()).toEqual(
        [...AI_CONFIG_KEYS].sort(),
      );
    });

    it('file có sẵn khóa → thay giá trị, KHÔNG nhân đôi dòng, giữ khóa không đổi', () => {
      service.updateAiConfig({ provider: 'old', apiKey: 'old-key' });

      service.updateAiConfig({ provider: 'new', apiKey: 'new-key' });

      const content = readFileSync(savedPath, 'utf8');
      expect(
        content.split('\n').filter((l) => l.startsWith('OPENROUTER_AI_PROVIDER=')),
      ).toHaveLength(1);
      expect(readSettingsConfigFile(savedPath)).toEqual({
        OPENROUTER_AI_PROVIDER: 'new',
        OPENROUTER_API_KEY: 'new-key',
      });
      expect(content).not.toContain('old-key');
    });

    it('apiKey="***" → KHÔNG ghi đè key thật (sentinel chống ghi nhầm) cả file lẫn process.env', () => {
      service.updateAiConfig({ apiKey: 'sk-real', nineRouterApiKey: 'sk-9r' });

      service.updateAiConfig({ apiKey: '***', nineRouterApiKey: '***' });

      expect(readSettingsConfigFile(savedPath)).toEqual({
        OPENROUTER_API_KEY: 'sk-real',
        NINEROUTER_API_KEY: 'sk-9r',
      });
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-real');
    });

    it('must1cApiKey="***" → giữ key cũ', () => {
      service.updateAiConfig({ must1cApiKey: 'm-old' });

      service.updateAiConfig({ must1cApiKey: '***' });

      expect(readSettingsConfigFile(savedPath).MUST1C_API_KEY).toBe('m-old');
    });

    it('field undefined/rỗng → bỏ qua, không tạo khóa mới và không đổi process.env', () => {
      service.updateAiConfig({ provider: 'keep' });

      service.updateAiConfig({ model: '', apiKey: undefined });

      expect(readSettingsConfigFile(savedPath)).toEqual({
        OPENROUTER_AI_PROVIDER: 'keep',
      });
      expect(process.env.OPENROUTER_AI_MODEL).toBeUndefined();
    });

    it('KHÔNG ghi vào .env (file .env của người vận hành không bị đụng tới)', () => {
      process.chdir(sandbox);
      delete process.env.SETTINGS_CONFIG_FILE;
      writeFileSync(envPath, 'OPENROUTER_AI_MODEL=human-managed\n');

      service.updateAiConfig({ model: 'saved-from-ui' });

      expect(readFileSync(envPath, 'utf8')).toBe(
        'OPENROUTER_AI_MODEL=human-managed\n',
      );
      // Mặc định: file riêng `.settings.env` cạnh cwd.
      expect(
        readSettingsConfigFile(join(realpathSync(sandbox), '.settings.env')),
      ).toEqual({ OPENROUTER_AI_MODEL: 'saved-from-ui' });
    });

    it('giá trị lưu rồi được nạp lại ở lần khởi động sau (vòng đi-về với applySettingsConfigFile)', () => {
      service.updateAiConfig({ model: 'persisted', apiKey: "k'e#y" });
      const freshProcessEnv: SettingsEnvTarget = {
        OPENROUTER_AI_MODEL: 'from-compose',
      };

      applySettingsConfigFile(freshProcessEnv, savedPath);

      expect(freshProcessEnv).toEqual({
        OPENROUTER_AI_MODEL: 'persisted',
        OPENROUTER_API_KEY: "k'e#y",
      });
    });

    it('giá trị chứa xuống dòng ở trường không có DTO chặn (provider) → 400, không ghi file, không đổi env', () => {
      expect(() =>
        service.updateAiConfig({ provider: 'x\nMONGODB_URI=evil' }),
      ).toThrow(BadRequestException);

      expect(existsSync(savedPath)).toBe(false);
      expect(process.env.OPENROUTER_AI_PROVIDER).toBeUndefined();
    });

    it('ghi file lỗi → ném lỗi và KHÔNG đổi process.env (bộ nhớ không lệch với file)', () => {
      mkdirSync(savedPath, { recursive: true }); // đích là thư mục → rename lỗi

      expect(() => service.updateAiConfig({ apiKey: SECRET })).toThrow();

      expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    });

    it('không rò giá trị API key vào log của service', () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        service.updateAiConfig({ apiKey: SECRET, nineRouterApiKey: SECRET });

        expect(JSON.stringify([logSpy.mock.calls, errorSpy.mock.calls])).not.toContain(
          SECRET,
        );
        expect(logSpy).toHaveBeenCalledTimes(1);
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
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

  describe('get9RouterModels', () => {
    afterEach(() => {
      delete process.env.NINEROUTER_API_KEY;
      delete process.env.NINEROUTER_BASE_URL;
    });

    it('thiếu API key → throw "9router API key is not configured"', async () => {
      configService.get.mockReturnValue(undefined);
      await expect(service.get9RouterModels()).rejects.toThrow(
        '9router API key is not configured',
      );
    });

    it('gọi fetch đúng url, header bearer và timeout (signal)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NINEROUTER_API_KEY') return 'sk-9router';
        if (key === 'NINEROUTER_BASE_URL') return 'http://127.0.0.1:20128/v1';
        return undefined;
      });
      const jsonMock = jest.fn().mockResolvedValue({ data: [{ id: 'llama' }] });
      (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: jsonMock,
      });

      const result = await service.get9RouterModels();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:20128/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-9router',
          }),
          signal: expect.any(AbortSignal),
        }),
      );
      expect(result).toEqual({ data: [{ id: 'llama' }] });
      expect(jsonMock).toHaveBeenCalled();
    });

    it('fetch trả !ok → throw với statusText', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NINEROUTER_API_KEY') return 'sk-9router';
        return undefined;
      });
      (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: jest.fn(),
      });

      await expect(service.get9RouterModels()).rejects.toThrow(
        'Failed to fetch 9router models: Unauthorized',
      );
    });
  });
});
