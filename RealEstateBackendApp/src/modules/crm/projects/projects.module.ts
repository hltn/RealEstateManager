import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { Area, AreaSchema } from '../catalogs/schemas/area.schema';
import { CrmCommonModule } from '../common/crm-common.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { Project, ProjectSchema } from './schemas/project.schema';

/** Dự án BĐS: CRUD + ngừng hoạt động + xóa mềm + khôi phục (X7, quyết định #8/#30–#32/#38). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Area.name, schema: AreaSchema },
    ]),
    CrmCommonModule,
    CrmAuditLogModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [MongooseModule],
})
export class ProjectsModule {}
