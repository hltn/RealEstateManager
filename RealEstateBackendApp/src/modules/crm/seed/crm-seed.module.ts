import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Area, AreaSchema } from '../catalogs/schemas/area.schema';
import {
  CatalogItem,
  CatalogItemSchema,
} from '../catalogs/schemas/catalog-item.schema';
import {
  CustomerStatus,
  CustomerStatusSchema,
} from '../catalogs/schemas/customer-status.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { CrmSeedService } from './crm-seed.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomerStatus.name, schema: CustomerStatusSchema },
      { name: CatalogItem.name, schema: CatalogItemSchema },
      { name: Area.name, schema: AreaSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  providers: [CrmSeedService],
  exports: [CrmSeedService],
})
export class CrmSeedModule {}
