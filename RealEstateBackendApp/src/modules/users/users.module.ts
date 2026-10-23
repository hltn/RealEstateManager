import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Team, TeamSchema } from '../teams/schemas/team.schema';
import { CrmAuditLogModule } from '../crm/audit-logs/crm-audit-log.module';
import { CrmCommonModule } from '../crm/common/crm-common.module';
import { TeamsModule } from '../teams/teams.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
    // TeamsService xử lý gán nhóm (PATCH /users/:id/team) vì nghiệp vụ thuộc miền "nhóm".
    TeamsModule,
    // ActiveAdminGuard (CrmActorService) + audit đổi vai trò/trạng thái.
    CrmCommonModule,
    CrmAuditLogModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
