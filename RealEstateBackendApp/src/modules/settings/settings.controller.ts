import { Controller, Get, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('ai-config')
  getAiConfig() {
    return this.settingsService.getAiConfig();
  }

  @Post('ai-config')
  updateAiConfig(
    @Body()
    body: {
      provider?: string;
      model?: string;
      apiKey?: string;
      must1cApiKey?: string;
      must1cModel?: string;
      activePlatform?: string;
    },
  ) {
    return this.settingsService.updateAiConfig(body);
  }

  @Get('openrouter-models')
  getOpenRouterModels() {
    return this.settingsService.getOpenRouterModels();
  }
}
