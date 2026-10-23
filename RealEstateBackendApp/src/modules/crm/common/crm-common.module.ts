import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Team, TeamSchema } from '../../teams/schemas/team.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmActorService } from './access/crm-actor.service';
import { CrmUsageService } from './crm-usage.service';

/** Dịch vụ nền dùng chung cho các module CRM: dựng người thực hiện + đếm tham chiếu. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
  ],
  providers: [CrmActorService, CrmUsageService],
  exports: [CrmActorService, CrmUsageService],
})
export class CrmCommonModule {}
