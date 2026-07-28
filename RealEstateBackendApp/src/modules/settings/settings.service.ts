import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private envPath = path.resolve(process.cwd(), '.env');

  constructor(private configService: ConfigService) {}

  getAiConfig() {
    const apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const must1cApiKey =
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
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
    activePlatform?: string;
  }) {
    let envContent = '';
    if (fs.existsSync(this.envPath)) {
      envContent = fs.readFileSync(this.envPath, 'utf8');
    }

    const updates: Record<string, string> = {};
    if (config.provider) updates['OPENROUTER_AI_PROVIDER'] = config.provider;
    if (config.model) updates['OPENROUTER_AI_MODEL'] = config.model;

    if (config.apiKey && config.apiKey !== '***') {
      updates['OPENROUTER_API_KEY'] = config.apiKey;
    }

    if (config.must1cApiKey && config.must1cApiKey !== '***') {
      updates['MUST1C_API_KEY'] = config.must1cApiKey;
    }
    if (config.must1cModel) {
      updates['MUST1C_MODEL'] = config.must1cModel;
    }
    if (config.activePlatform) {
      updates['ACTIVE_AI_PLATFORM'] = config.activePlatform;
    }

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        // if file doesn't end with newline, add one
        if (envContent && !envContent.endsWith('\n')) {
          envContent += '\n';
        }
        envContent += `${key}=${value}\n`;
      }
      process.env[key] = value;
    }

    fs.writeFileSync(this.envPath, envContent, 'utf8');
    this.logger.log('AI configuration updated in .env');

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
}
