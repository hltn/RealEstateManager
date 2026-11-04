import { Module } from '@nestjs/common';
import { PendingMigrationsWarningService } from './pending-migrations-warning.service';

/** Module nhỏ chỉ để đăng ký log cảnh báo migration chờ lúc khởi động (MongooseModule/ConfigModule toàn cục). */
@Module({ providers: [PendingMigrationsWarningService] })
export class MigrationsWarningModule {}
