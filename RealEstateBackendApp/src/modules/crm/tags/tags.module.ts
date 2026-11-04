import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmCommonModule } from '../common/crm-common.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Tag, TagSchema } from './schemas/tag.schema';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

/** Thẻ sở thích/nghề nghiệp (M4, tài liệu 04 mục 2.2 `crm/tags`). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tag.name, schema: TagSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    CrmCommonModule,
    CrmAuditLogModule,
    CrmSecurityModule,
  ],
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
