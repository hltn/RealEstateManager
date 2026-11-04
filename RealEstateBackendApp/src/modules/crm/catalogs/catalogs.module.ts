import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmCommonModule } from '../common/crm-common.module';
import { AreasController } from './areas.controller';
import { AreasService } from './areas.service';
import { CatalogItemsService } from './catalog-items.service';
import { ContactResultsController } from './contact-results.controller';
import { CustomerStatusesController } from './customer-statuses.controller';
import { CustomerStatusesService } from './customer-statuses.service';
import { LeadSourcesController } from './lead-sources.controller';
import { Area, AreaSchema } from './schemas/area.schema';
import { CatalogItem, CatalogItemSchema } from './schemas/catalog-item.schema';
import {
  CustomerStatus,
  CustomerStatusSchema,
} from './schemas/customer-status.schema';

/** Danh mục CRM: tình trạng khách, nguồn khách, kết quả liên hệ, khu vực (X7). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomerStatus.name, schema: CustomerStatusSchema },
      { name: CatalogItem.name, schema: CatalogItemSchema },
      { name: Area.name, schema: AreaSchema },
    ]),
    CrmCommonModule,
    CrmAuditLogModule,
  ],
  controllers: [
    CustomerStatusesController,
    LeadSourcesController,
    ContactResultsController,
    AreasController,
  ],
  providers: [CustomerStatusesService, CatalogItemsService, AreasService],
  exports: [MongooseModule],
})
export class CatalogsModule {}
