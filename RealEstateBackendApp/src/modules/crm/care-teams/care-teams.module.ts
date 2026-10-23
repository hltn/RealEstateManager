import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { CustomersModule } from '../customers/customers.module';
import { CareTeamAssigneesService } from './care-team-assignees.service';
import { CareTeamRequestsController } from './care-team-requests.controller';
import { CareTeamRequestsService } from './care-team-requests.service';
import { CareTeamController } from './care-team.controller';
import { CareTeamService } from './care-team.service';
import {
  CareTeamRequest,
  CareTeamRequestSchema,
} from './schemas/care-team-request.schema';

/** Nhóm chăm sóc của khách và đề nghị tham gia (M3, tài liệu 04 mục 2.3 `crm/care-teams`). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CareTeamRequest.name, schema: CareTeamRequestSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CustomersModule,
    CrmAuditLogModule,
    CrmSecurityModule,
  ],
  controllers: [CareTeamController, CareTeamRequestsController],
  providers: [
    CareTeamAssigneesService,
    CareTeamService,
    CareTeamRequestsService,
  ],
  // Dùng lại cho thao tác hàng loạt `ASSIGN`.
  exports: [CareTeamService],
})
export class CareTeamsModule {}
