import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmAuditLogModule } from '../crm/audit-logs/crm-audit-log.module';
import { CrmCommonModule } from '../crm/common/crm-common.module';
import { CustomerTeamSyncModule } from '../crm/customers/customer-team-sync.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Team, TeamSchema } from './schemas/team.schema';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/** Nhóm làm việc (cấp tổ chức, không nằm dưới `/crm`). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Team.name, schema: TeamSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CrmCommonModule,
    CrmAuditLogModule,
    CustomerTeamSyncModule,
  ],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
