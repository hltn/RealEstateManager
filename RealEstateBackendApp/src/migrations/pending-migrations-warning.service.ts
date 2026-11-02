import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { sanitizeErrorMessage } from './migration-error.util';
import { countPendingMigrations } from './migration-state';
import { MIGRATIONS } from './migration.registry';
import type { Migration } from './migration.types';
import { MIGRATION_UP_COMMAND } from './system.constants';

/**
 * Khi backend khởi động: nếu registry còn migration CHƯA vào sổ `system` thì chỉ ghi log cảnh báo (kèm lệnh chạy).
 * Backend KHÔNG tự chạy migration và KHÔNG từ chối khởi động vì lý do này (việc chạy do `deploy.sh`/người vận hành);
 * mọi lỗi khi kiểm tra đều bị nuốt và ghi log để không làm hỏng khởi động. `NODE_ENV=test` bỏ qua hoàn toàn.
 */
@Injectable()
export class PendingMigrationsWarningService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PendingMigrationsWarningService.name);
  /** Cho phép test thay registry; mặc định là registry thật. */
  private readonly migrations: readonly Migration[] = MIGRATIONS;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.configService.get<string>('NODE_ENV') === 'test') return;
    if (this.migrations.length === 0) return;

    try {
      const db = this.connection.getClient().db(this.connection.name);
      const pending = await countPendingMigrations(db, this.migrations);
      if (pending > 0) {
        this.logger.warn(
          `Còn ${pending} migration chờ chạy (chưa có trong collection system). Backend vẫn khởi động; ` +
            `chạy \`${MIGRATION_UP_COMMAND}\` (dry-run trước, sao lưu trước).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Không kiểm tra được migration chờ: ${sanitizeErrorMessage(error)}`,
      );
    }
  }
}
