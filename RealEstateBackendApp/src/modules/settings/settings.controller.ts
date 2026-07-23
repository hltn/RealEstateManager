import { Controller, Get, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('ai-config')
  getAiConfig() {
    return this.settingsService.getAiConfig();
  }

  @Post('ai-config')
  updateAiConfig(@Body() body: { provider?: string; model?: string; apiKey?: string }) {
    return this.settingsService.updateAiConfig(body);
  }

  @Get('openrouter-models')
  getOpenRouterModels() {
    return this.settingsService.getOpenRouterModels();
  }
}
