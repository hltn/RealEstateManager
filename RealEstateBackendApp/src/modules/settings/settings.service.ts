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
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || process.env.OPENROUTER_API_KEY;
    return {
      provider: this.configService.get<string>('AI_PROVIDER') || process.env.AI_PROVIDER || 'OpenRouter',
      model: this.configService.get<string>('AI_MODEL') || process.env.AI_MODEL || 'google/gemini-2.5-flash',
      apiKey: apiKey ? '***' : '',
    };
  }

  updateAiConfig(config: { provider?: string; model?: string; apiKey?: string }) {
    let envContent = '';
    if (fs.existsSync(this.envPath)) {
      envContent = fs.readFileSync(this.envPath, 'utf8');
    }

    const updates: Record<string, string> = {};
    if (config.provider) updates['AI_PROVIDER'] = config.provider;
    if (config.model) updates['AI_MODEL'] = config.model;
    
    if (config.apiKey && config.apiKey !== '***') {
      updates['OPENROUTER_API_KEY'] = config.apiKey;
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
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured');
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'RealEstateManager',
        },
      });

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
