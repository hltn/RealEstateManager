import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiConfigValues,
  resolveSettingsConfigPath,
  writeSettingsConfigFile,
} from '../../common/config/settings-config-file';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private configService: ConfigService) {}

  getAiConfig() {
    const apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const must1cApiKey =
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
    const nineRouterApiKey =
      this.configService.get<string>('NINEROUTER_API_KEY') ||
      process.env.NINEROUTER_API_KEY;
    return {
      provider:
        this.configService.get<string>('OPENROUTER_AI_PROVIDER') ||
        process.env.OPENROUTER_AI_PROVIDER ||
        'OpenRouter',
      model:
        this.configService.get<string>('OPENROUTER_AI_MODEL') ||
        process.env.OPENROUTER_AI_MODEL ||
        'google/gemini-2.5-flash',
      apiKey: apiKey ? '***' : '',
      must1cApiKey: must1cApiKey ? '***' : '',
      must1cModel:
        this.configService.get<string>('MUST1C_MODEL') ||
        process.env.MUST1C_MODEL ||
        '',
      nineRouterBaseUrl:
        this.configService.get<string>('NINEROUTER_BASE_URL') ||
        process.env.NINEROUTER_BASE_URL ||
        'http://127.0.0.1:20128/v1',
      nineRouterApiKey: nineRouterApiKey ? '***' : '',
      nineRouterModel:
        this.configService.get<string>('NINEROUTER_MODEL') ||
        process.env.NINEROUTER_MODEL ||
        '',
      activePlatform:
        this.configService.get<string>('ACTIVE_AI_PLATFORM') ||
        process.env.ACTIVE_AI_PLATFORM ||
        'OpenRouter',
    };
  }

  updateAiConfig(config: {
    provider?: string;
    model?: string;
    apiKey?: string;
    must1cApiKey?: string;
    must1cModel?: string;
    nineRouterBaseUrl?: string;
    nineRouterApiKey?: string;
    nineRouterModel?: string;
    activePlatform?: string;
  }) {
    const updates: AiConfigValues = {};
    if (config.provider) updates.OPENROUTER_AI_PROVIDER = config.provider;
    if (config.model) updates.OPENROUTER_AI_MODEL = config.model;

    if (config.apiKey && config.apiKey !== '***') {
      updates.OPENROUTER_API_KEY = config.apiKey;
    }

    if (config.must1cApiKey && config.must1cApiKey !== '***') {
      updates.MUST1C_API_KEY = config.must1cApiKey;
    }
    if (config.must1cModel) {
      updates.MUST1C_MODEL = config.must1cModel;
    }
    if (config.nineRouterBaseUrl) {
      updates.NINEROUTER_BASE_URL = config.nineRouterBaseUrl;
    }
    if (config.nineRouterApiKey && config.nineRouterApiKey !== '***') {
      updates.NINEROUTER_API_KEY = config.nineRouterApiKey;
    }
    if (config.nineRouterModel) {
      updates.NINEROUTER_MODEL = config.nineRouterModel;
    }
    if (config.activePlatform) {
      updates.ACTIVE_AI_PLATFORM = config.activePlatform;
    }

    // Chống env injection ở mọi khóa (DTO chỉ chặn một phần): xuống dòng trong giá trị sẽ chèn thêm biến vào file.
    for (const [key, value] of Object.entries(updates)) {
      if (/[\r\n]/.test(value)) {
        throw new BadRequestException(
          `Giá trị của ${key} không được chứa ký tự xuống dòng`,
        );
      }
    }

    // Ghi bền vào file riêng (SETTINGS_CONFIG_FILE, không phải .env) TRƯỚC khi đổi process.env: ghi lỗi thì
    // không để bộ nhớ lệch với file. File được nạp lại lúc khởi động (load-env.ts) nên sống qua restart.
    const filePath = resolveSettingsConfigPath();
    writeSettingsConfigFile(filePath, updates);
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }
    this.logger.log(
      `AI configuration saved to ${filePath} (${Object.keys(updates).length} keys changed)`,
    );

    return { success: true };
  }

  async getOpenRouterModels() {
    const apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured');
    }

    try {
      // Bọc timeout 5s chống treo khi OpenRouter chậm/không phản hồi
      // (chuẩn Enterprise: mọi request 3rd party phải có timeout).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let response: Response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/models', {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'RealEstateManager',
          },
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw new Error('OpenRouter models request timed out after 5s');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error('Error fetching OpenRouter models', error);
      throw error;
      }
      }

      async get9RouterModels() {
      const baseUrl =
      this.configService.get<string>('NINEROUTER_BASE_URL') ||
      process.env.NINEROUTER_BASE_URL ||
      'http://127.0.0.1:20128/v1';
      const apiKey =
      this.configService.get<string>('NINEROUTER_API_KEY') ||
      process.env.NINEROUTER_API_KEY;

      if (!apiKey) {
      throw new Error('9router API key is not configured');
      }

      try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'RealEstateManager',
          },
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw new Error('9router models request timed out after 5s');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch 9router models: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
      } catch (error) {
      this.logger.error('Error fetching 9router models', error);
      throw error;
      }
      }
      }
