import { Module } from '@nestjs/common';
import { AssignableUsersModule } from './assignable-users/assignable-users.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { CrmSettingsModule } from './crm-settings/crm-settings.module';
import { ProjectsModule } from './projects/projects.module';
import { CrmSeedModule } from './seed/crm-seed.module';

/**
 * Module tổng của CRM (tài liệu 04 mục 2.2). Các module con khai báo controller của mình; việc bật/tắt
 * theo `FEATURE_CRM_ENABLED` do `CrmFeatureGuard` (route -> 404 khi tắt) và `CrmSeedService` (không seed khi tắt) đảm nhiệm.
 * Các milestone sau (khách hàng, chăm sóc, lịch hẹn...) thêm module con vào đây.
 *
 * `/teams` thuộc `TeamsModule` (cấp tổ chức, ngoài `/crm`) nhưng cùng nằm sau cổng tính năng này.
 */
@Module({
  imports: [
    CatalogsModule,
    ProjectsModule,
    AssignableUsersModule,
    CrmSettingsModule,
    CrmSeedModule,
  ],
})
export class CrmModule {}
