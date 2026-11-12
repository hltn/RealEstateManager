import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmCommonModule } from '../common/crm-common.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { Team, TeamSchema } from '../../teams/schemas/team.schema';
import { CustomersModule } from '../customers/customers.module';
import { CareTeamAssigneesService } from './care-team-assignees.service';
import { CareTeamInviteesController } from './care-team-invitees.controller';
import { CareTeamInviteesService } from './care-team-invitees.service';
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
    CrmCommonModule,
  ],
  controllers: [CareTeamController, CareTeamInviteesController],
  providers: [
    CareTeamAssigneesService,
    CareTeamInviteesService,
    CareTeamService,
  ],
  // Dùng lại cho thao tác hàng loạt `ASSIGN`.
  exports: [CareTeamService],
})
export class CareTeamsModule {}
