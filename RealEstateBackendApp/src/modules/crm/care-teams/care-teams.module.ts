import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { Team, TeamSchema } from '../../teams/schemas/team.schema';
import { CustomersModule } from '../customers/customers.module';
import { CareTeamAssigneesService } from './care-team-assignees.service';
import { CareTeamController } from './care-team.controller';
import { CareTeamService } from './care-team.service';

/** Nhóm chăm sóc của khách (M3, tài liệu 04 mục 2.3 `crm/care-teams`); luồng đề nghị tham gia đã bỏ ở v1.0.5 (T-13). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
    CustomersModule,
    NotificationsModule,
    CrmAuditLogModule,
    CrmSecurityModule,
  ],
  controllers: [CareTeamController],
  providers: [CareTeamAssigneesService, CareTeamService],
  // Dùng lại cho thao tác hàng loạt `ASSIGN`.
  exports: [CareTeamService],
})
export class CareTeamsModule {}
