import { Controller, Get } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { isSwaggerEnabled, setupSwagger, SWAGGER_PATH } from './swagger.config';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

const buildApp = async (): Promise<NestFastifyApplication> => {
  const moduleRef = await Test.createTestingModule({
    controllers: [PingController],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api/v1');
  return app;
};

describe('swagger.config (PT-008)', () => {
  describe('isSwaggerEnabled', () => {
    it.each([
      ['production'],
      ['Production'],
      ['PRODUCTION'],
      [' production '],
      ['production\r'],
      ['production\r\n'],
      ['\tproduction\n'],
    ])(
      'tắt khi NODE_ENV=%j (production, mọi cách viết/khoảng trắng)',
      (nodeEnv) => {
        expect(isSwaggerEnabled(nodeEnv)).toBe(false);
      },
    );

    it.each([
      ['prod'],
      ['prodution'],
      ['live'],
      ['banana'],
      ['development-production'],
      [''],
      ['   '],
    ])('fail-safe: giá trị lạ/chưa đặt NODE_ENV=%j => tắt', (nodeEnv) => {
      expect(isSwaggerEnabled(nodeEnv)).toBe(false);
    });

    it.each([
      ['development'],
      ['staging'],
      ['test'],
      ['local'],
      ['Development'],
      [' test\r'],
    ])(
      'bật khi NODE_ENV=%j (môi trường phi-production được liệt kê)',
      (nodeEnv) => {
        expect(isSwaggerEnabled(nodeEnv)).toBe(true);
      },
    );

    it('mặc định đọc process.env.NODE_ENV', () => {
      const original = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(isSwaggerEnabled()).toBe(false);
        process.env.NODE_ENV = 'development';
        expect(isSwaggerEnabled()).toBe(true);
        delete process.env.NODE_ENV;
        expect(isSwaggerEnabled()).toBe(false);
      } finally {
        if (original === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = original;
      }
    });
  });

  describe('setupSwagger', () => {
    it.each([['production'], ['Production'], [' production\r'], ['prod']])(
      'NODE_ENV=%j: không đăng ký route docs/docs-json/docs-yaml (404) nhưng API thường vẫn chạy',
      async (nodeEnv) => {
        const app = await buildApp();
        expect(setupSwagger(app, nodeEnv)).toBe(false);
        await app.init();
        await app.getHttpAdapter().getInstance().ready();

        const urls = [
          `/${SWAGGER_PATH}`,
          `/${SWAGGER_PATH}/`,
          `/${SWAGGER_PATH}-json`,
          `/${SWAGGER_PATH}-yaml`,
        ];
        for (const url of urls) {
          const res = await app.inject({ method: 'GET', url });
          expect([url, res.statusCode]).toEqual([url, 404]);
        }
        const ping = await app.inject({ method: 'GET', url: '/api/v1/ping' });
        expect(ping.statusCode).toBe(200);
        await app.close();
      },
    );

    it('NODE_ENV chưa đặt (undefined): fail-safe, không đăng ký route docs', async () => {
      const original = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      try {
        const app = await buildApp();
        expect(setupSwagger(app)).toBe(false);
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
        const res = await app.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}-json`,
        });
        expect(res.statusCode).toBe(404);
        await app.close();
      } finally {
        if (original !== undefined) process.env.NODE_ENV = original;
      }
    });

    it.each([['development'], ['staging'], ['test'], ['local']])(
      'NODE_ENV=%s: có route docs, docs-json và docs-yaml mô tả API',
      async (nodeEnv) => {
        const app = await buildApp();
        expect(setupSwagger(app, nodeEnv)).toBe(true);
        await app.init();
        await app.getHttpAdapter().getInstance().ready();

        const json = await app.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}-json`,
        });
        const yaml = await app.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}-yaml`,
        });
        const docs = await app.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}`,
        });

        expect(json.statusCode).toBe(200);
        expect(json.body).toContain('"/api/v1/ping"');
        expect(yaml.statusCode).toBe(200);
        expect(yaml.body).toContain('/api/v1/ping');
        expect([200, 302]).toContain(docs.statusCode);
        await app.close();
      },
    );
  });
});
