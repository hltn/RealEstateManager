import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NewsFireCrawlManagerModule } from './modules/news-fire-crawl-manager/news-fire-crawl-manager.module';
import { ExternalLogModule } from './modules/external-log/external-log.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthModule } from './health.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { GoogleDriveExportModule } from './modules/google-drive-export/google-drive-export.module';
import { KnowledgeArticlesModule } from './modules/knowledge-articles/knowledge-articles.module';
import { SharedModule } from './shared/shared.module';
import { RedisModule } from './shared/redis/redis.module';
import { QueueModule } from './shared/queue/queue.module';
import { StorageModule } from './shared/storage/storage.module';
import { FeatureFlagModule } from './shared/feature-flags/feature-flag.module';
import { PiiCryptoModule } from './modules/crm/common/crypto/pii-crypto.module';
import { CrmModule } from './modules/crm/crm.module';
import { TeamsModule } from './modules/teams/teams.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'RealEstateAdminApp', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    // Hạ tầng dùng chung (stateless): Redis, BullMQ, S3/MinIO, feature flag, mã hóa PII.
    RedisModule,
    QueueModule,
    StorageModule,
    FeatureFlagModule,
    PiiCryptoModule,
    ExternalLogModule,
    SharedModule,
    NewsFireCrawlManagerModule,
    SettingsModule,
    HealthModule,
    // Auth + Users: bật global JwtAuthGuard/RolesGuard/ThrottlerGuard.
    AuthModule,
    UsersModule,
    // CRM: nhóm làm việc + danh mục + dự án (M1). Route CRM nằm sau cờ FEATURE_CRM_ENABLED.
    TeamsModule,
    CrmModule,
    // Google Drive Export (OAuth2 flow + Export).
    GoogleDriveExportModule,
    // Knowledge Articles (auto-write, auto-publish pipeline).
    KnowledgeArticlesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  /**
   * Đăng ký RequestContextMiddleware toàn cục để mọi route đều có X-Request-ID
   * được lưu vào AsyncLocalStorage trước khi handler chạy.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
