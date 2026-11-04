import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmCommonModule } from '../common/crm-common.module';
import { CrmSettingsController } from './crm-settings.controller';
import { CrmSettingsService } from './crm-settings.service';
import { CrmSettings, CrmSettingsSchema } from './schemas/crm-settings.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmSettings.name, schema: CrmSettingsSchema },
    ]),
    CrmAuditLogModule,
    CrmCommonModule,
  ],
  controllers: [CrmSettingsController],
  providers: [CrmSettingsService],
  exports: [CrmSettingsService],
})
export class CrmSettingsModule {}
