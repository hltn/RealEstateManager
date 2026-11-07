import { Controller, Get, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateAiConfigDto } from './dtos/settings.dto';
import { AdminOnly } from '../crm/common/access/admin-only.decorator';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @AdminOnly()
  @Get('ai-config')
  @ApiOperation({
    summary: 'Get current AI configuration',
    description: 'Get current AI configuration',
  })
  getAiConfig() {
    return this.settingsService.getAiConfig();
  }

  @AdminOnly()
  @Post('ai-config')
  @ApiOperation({
    summary: 'Update AI configuration',
    description: 'Update AI configuration',
  })
  updateAiConfig(@Body() body: UpdateAiConfigDto) {
    return this.settingsService.updateAiConfig(body);
  }

  @AdminOnly()
  @Get('openrouter-models')
  @ApiOperation({
    summary: 'Get list of available OpenRouter models',
    description: 'Get list of available OpenRouter models',
  })
  getOpenRouterModels() {
    return this.settingsService.getOpenRouterModels();
  }

  @AdminOnly()
  @Get('9router-models')
  @ApiOperation({
    summary: 'Get list of available 9router models',
    description: 'Get list of available 9router models',
  })
  get9RouterModels() {
    return this.settingsService.get9RouterModels();
  }
  }
