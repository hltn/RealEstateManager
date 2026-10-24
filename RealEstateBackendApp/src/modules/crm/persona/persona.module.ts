import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { CrmCommonModule } from '../common/crm-common.module';
import { CustomersModule } from '../customers/customers.module';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { CustomerPersonaController } from './customer-persona.controller';
import { CustomerPersonaService } from './customer-persona.service';
import { PersonaConfigService } from './persona-config.service';
import { PersonaFieldsController } from './persona-fields.controller';
import { PersonaFieldsService } from './persona-fields.service';
import { PersonaRecomputeService } from './persona-recompute.service';
import { PersonaSeedService } from './persona-seed.service';
import {
  PersonaField,
  PersonaFieldSchema,
} from './schemas/persona-field.schema';

/** Chân dung khách: cấu hình trường (X10), giá trị chân dung (C10), độ đầy đủ + job tính lại (C12). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PersonaField.name, schema: PersonaFieldSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    // `CatalogsModule` xuất MongooseModule (model `CatalogItem` cho nhóm trường).
    CatalogsModule,
    CustomersModule,
    CrmCommonModule,
    CrmAuditLogModule,
  ],
  controllers: [PersonaFieldsController, CustomerPersonaController],
  providers: [
    PersonaConfigService,
    PersonaRecomputeService,
    PersonaFieldsService,
    CustomerPersonaService,
    PersonaSeedService,
  ],
  exports: [PersonaConfigService],
})
export class PersonaModule {}
