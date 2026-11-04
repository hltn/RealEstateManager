/**
 * INTEGRATION — trustProxy với Fastify thật: req.ip (cái ThrottlerGuard dùng làm khóa đếm)
 * và ip trong RequestContext (audit log) phải là IP client thật khi bật TRUST_PROXY=1,
 * và là IP kết nối khi tắt. Không cần Mongo/Redis. Chạy bằng `npm run test:integration`.
 */
import {
  Controller,
  Get,
  MiddlewareConsumer,
  Module,
  NestModule,
  Req,
} from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { RequestContextMiddleware } from '../middleware/request-context.middleware';
import { requestContextStorage } from '../services/request-context.service';
import { resolveTrustProxy } from './trust-proxy.config';

const NGINX_IP = '172.18.0.5';

@Controller('probe')
class IpProbeController {
  @Get('ip')
  ip(@Req() req: FastifyRequest) {
    return { reqIp: req.ip, auditIp: requestContextStorage.getStore()?.ip };
  }
}

@Module({ controllers: [IpProbeController] })
class IpProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

async function createApp(raw: string | undefined) {
  // Dựng bằng NestFactory.create + FastifyAdapter({ trustProxy }) giống main.ts (không dùng Test.createNestApplication)
  // để bắt lỗi thứ tự đăng ký middie/hook; middleware lấy IP từ req.ip mà middie gán lên request thô.
  const app = await NestFactory.create<NestFastifyApplication>(
    IpProbeModule,
    new FastifyAdapter({ trustProxy: resolveTrustProxy(raw) }),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

async function getIps(app: NestFastifyApplication, xff: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/probe/ip',
    remoteAddress: NGINX_IP,
    headers: { 'x-forwarded-for': xff },
  });
  return res.json<{ reqIp: string; auditIp: string }>();
}

describe('TRUST_PROXY với Fastify thật', () => {
  it('bật (1): mỗi client có IP riêng theo X-Forwarded-For, cả req.ip lẫn audit', async () => {
    const app = await createApp('1');
    try {
      expect(await getIps(app, '203.0.113.7')).toEqual({
        reqIp: '203.0.113.7',
        auditIp: '203.0.113.7',
      });
      expect(await getIps(app, '198.51.100.9')).toEqual({
        reqIp: '198.51.100.9',
        auditIp: '198.51.100.9',
      });
      // Client giả mạo thêm giá trị bên trái: chỉ tin entry nginx ghi (cuối chuỗi).
      expect((await getIps(app, '1.1.1.1, 203.0.113.7')).reqIp).toBe(
        '203.0.113.7',
      );
    } finally {
      await app.close();
    }
  });

  it('tắt: mọi client chung IP kết nối, bỏ qua X-Forwarded-For', async () => {
    const app = await createApp('');
    try {
      const a = await getIps(app, '203.0.113.7');
      const b = await getIps(app, '198.51.100.9');
      expect(a).toEqual({ reqIp: NGINX_IP, auditIp: NGINX_IP });
      expect(b).toEqual(a);
    } finally {
      await app.close();
    }
  });
});
