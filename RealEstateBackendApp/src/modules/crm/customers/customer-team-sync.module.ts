import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CustomerTeamSyncService } from './customer-team-sync.service';
import { Customer, CustomerSchema } from './schemas/customer.schema';

/**
 * Module nhỏ chỉ chứa việc đồng bộ `customers.teamIds`, để `TeamsModule`/`UsersModule` dùng được mà không phải
 * import cả `CustomersModule` (tránh vòng phụ thuộc giữa người dùng - nhóm - khách).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [CustomerTeamSyncService],
  exports: [CustomerTeamSyncService],
})
export class CustomerTeamSyncModule {}
