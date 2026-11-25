import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ConfigModule } from '@nestjs/config';
import { CrmCommonModule } from '../crm/common/crm-common.module';

@Module({
  // CrmCommonModule: cung cấp CrmActorService cho ActiveAdminGuard của @AdminOnly() (FR-21).
  imports: [ConfigModule, CrmCommonModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
