import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Team, TeamSchema } from '../../teams/schemas/team.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmCommonModule } from '../common/crm-common.module';
import { AssignableUsersController } from './assignable-users.controller';
import { AssignableUsersService } from './assignable-users.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
    CrmCommonModule,
  ],
  controllers: [AssignableUsersController],
  providers: [AssignableUsersService],
})
export class AssignableUsersModule {}
