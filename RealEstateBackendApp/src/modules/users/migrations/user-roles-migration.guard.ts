import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { USERS_PENDING_ROLES_TEAM_IDS_FILTER } from './backfill-user-roles-team-ids';

export const USER_ROLES_MIGRATION_COMMAND =
  'npx ts-node scripts/migrations/005_users_roles_teamids.ts --apply';

/**
 * Guard khởi động: code mới đọc/lọc theo `users.roles`/`users.teamIds`, nên nếu còn tài khoản CHƯA migrate (migration 005)
 * thì danh sách người phân công rỗng, kiểm tra "ADMIN cuối cùng" sai, v.v.
 * - "Chưa migrate" = `roles` thiếu/null/sai kiểu (không phải mảng) hoặc rỗng, hoặc `teamIds` thiếu/null/sai kiểu.
 * - Còn tài khoản chưa migrate như trên: ghi cảnh báo kèm số lượng + lệnh chạy migration.
 * - `NODE_ENV=production`: ném lỗi để KHÔNG khởi động (fail-fast), tránh chạy code mới trên dữ liệu cũ.
 * - `NODE_ENV=test`: bỏ qua hoàn toàn (không truy vấn DB), như `AuthService.seedAdmin`.
 * Thứ tự triển khai: mongodump → 005 --dry-run → 005 --apply → rồi mới chạy code mới.
 */
@Injectable()
export class UserRolesMigrationGuard implements OnModuleInit {
  private readonly logger = new Logger(UserRolesMigrationGuard.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'test') return;

    const pending = await this.userModel
      .countDocuments(USERS_PENDING_ROLES_TEAM_IDS_FILTER)
      .exec();
    if (pending === 0) return;

    const message =
      `Còn ${pending} tài khoản chưa có roles/teamIds (chưa chạy migration 005). ` +
      `Chạy: ${USER_ROLES_MIGRATION_COMMAND} (sao lưu bằng mongodump và chạy --dry-run trước).`;
    if (nodeEnv === 'production') {
      throw new Error(`${message} Từ chối khởi động ở production.`);
    }
    this.logger.warn(message);
  }
}
