import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenSchema,
} from './schemas/refresh-token.schema';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CustomLogger } from '../../common/logger/custom-logger.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          // `expiresIn` thuộc kiểu `StringValue` (branded) của `ms` — giá trị từ
          // env là `string` widen nên phải ép kiểu. Chuẩn '15m'/'7d' hợp lệ runtime.
          expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES_IN') ||
            '15m') as never,
        },
      }),
    }),
    // Throttler mặc định 100 req/phút cho mọi route; login override 5/phút.
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: 100 },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CustomLogger,
    // Thứ tự global APP_GUARD: ThrottlerGuard → JwtAuthGuard → RolesGuard.
    // ThrottlerGuard phải có để @Throttle trên login có hiệu lực (bổ sung so
    // với doc mục 8 chỉ liệt kê 2 guard — @Throttle không chạy nếu thiếu guard này).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
