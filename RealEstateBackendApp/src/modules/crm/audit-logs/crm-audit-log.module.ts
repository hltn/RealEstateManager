import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmAuditLogService } from './crm-audit-log.service';
import { CrmAuditLog, CrmAuditLogSchema } from './schemas/crm-audit-log.schema';

/** Nhật ký audit CRM dùng chung. M1 chỉ ghi; API đọc lịch sử/`audit-logs` thuộc M2. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmAuditLog.name, schema: CrmAuditLogSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [CrmAuditLogService],
  exports: [CrmAuditLogService],
})
export class CrmAuditLogModule {}
