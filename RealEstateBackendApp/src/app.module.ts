import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NewsFireCrawlManagerModule } from './modules/news-fire-crawl-manager/news-fire-crawl-manager.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthModule } from './health.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { GoogleDriveExportModule } from './modules/google-drive-export/google-drive-export.module';
import { KnowledgeArticlesModule } from './modules/knowledge-articles/knowledge-articles.module';

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
    NewsFireCrawlManagerModule,
    SettingsModule,
    HealthModule,
    // Auth + Users: bật global JwtAuthGuard/RolesGuard/ThrottlerGuard.
    AuthModule,
    UsersModule,
    // Google Drive Export (OAuth2 flow + Export).
    GoogleDriveExportModule,
    // Knowledge Articles (Config CRUD, Pipeline, NL Cron).
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
