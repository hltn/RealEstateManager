import { Controller, Get, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateAiConfigDto } from './dtos/settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Roles(UserRole.ADMIN)
  @Get('ai-config')
  @ApiOperation({
    summary: 'Get current AI configuration',
    description: 'Get current AI configuration',
  })
  getAiConfig() {
    return this.settingsService.getAiConfig();
  }

  @Roles(UserRole.ADMIN)
  @Post('ai-config')
  @ApiOperation({
    summary: 'Update AI configuration',
    description: 'Update AI configuration',
  })
  updateAiConfig(@Body() body: UpdateAiConfigDto) {
    return this.settingsService.updateAiConfig(body);
  }

  @Roles(UserRole.ADMIN)
  @Get('openrouter-models')
  @ApiOperation({
    summary: 'Get list of available OpenRouter models',
    description: 'Get list of available OpenRouter models',
  })
  getOpenRouterModels() {
    return this.settingsService.getOpenRouterModels();
  }
}
