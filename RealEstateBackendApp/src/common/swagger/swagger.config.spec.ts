import { Controller, Get } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  isSwaggerEnabled,
  setupSwagger,
  setupSwaggerFromConfig,
  SWAGGER_ENABLED_ENV,
  SWAGGER_PATH,
} from './swagger.config';

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

describe('swagger.config (CRM_SWAGGER_ENABLED, FR-18)', () => {
  describe('isSwaggerEnabled', () => {
    it('tên biến môi trường là CRM_SWAGGER_ENABLED', () => {
      expect(SWAGGER_ENABLED_ENV).toBe('CRM_SWAGGER_ENABLED');
    });

    it.each([
      ['true'],
      ['TRUE'],
      ['True'],
      ['1'],
      ['yes'],
      ['YES'],
      ['on'],
      ['On'],
      [' true '],
      ['true\r'],
      ['true\r\n'],
      ['\ton\n'],
    ])(
      'bật khi CRM_SWAGGER_ENABLED=%j (truthy, không phân biệt hoa thường)',
      (raw) => {
        expect(isSwaggerEnabled(raw)).toBe(true);
      },
    );

    it('bật khi nhận boolean true (ConfigService đã ép kiểu)', () => {
      expect(isSwaggerEnabled(true)).toBe(true);
    });

    it.each([
      ['false'],
      ['FALSE'],
      ['0'],
      ['no'],
      ['off'],
      [''],
      ['   '],
      ['tru'],
      ['truee'],
      ['enabled'],
      ['2'],
      ['production'],
      ['development'],
    ])('tắt khi CRM_SWAGGER_ENABLED=%j (sai/lạ/rỗng => fail-safe)', (raw) => {
      expect(isSwaggerEnabled(raw)).toBe(false);
    });

    it.each([[undefined], [null], [false], [1], [{}]])(
      'tắt (mặc định false) khi giá trị là %p',
      (raw) => {
        expect(isSwaggerEnabled(raw)).toBe(false);
      },
    );

    it('hàm thuần: chỉ phụ thuộc tham số, KHÔNG đọc process.env (NODE_ENV hay chính CRM_SWAGGER_ENABLED)', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalFlag = process.env.CRM_SWAGGER_ENABLED;
      try {
        process.env.NODE_ENV = 'production';
        process.env.CRM_SWAGGER_ENABLED = 'true';
        expect(isSwaggerEnabled(undefined)).toBe(false);
        expect(isSwaggerEnabled('false')).toBe(false);

        process.env.NODE_ENV = 'development';
        process.env.CRM_SWAGGER_ENABLED = 'false';
        expect(isSwaggerEnabled('true')).toBe(true);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalFlag === undefined) delete process.env.CRM_SWAGGER_ENABLED;
        else process.env.CRM_SWAGGER_ENABLED = originalFlag;
      }
    });

    it('NODE_ENV=production vẫn bật được khi cờ bật (NODE_ENV không còn quyết định Swagger)', () => {
      const original = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(isSwaggerEnabled('true')).toBe(true);
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });

  describe('setupSwagger', () => {
    it.each([['false'], [''], ['   '], ['abc'], [undefined], [null]])(
      'CRM_SWAGGER_ENABLED=%j: không đăng ký route docs/docs-json/docs-yaml (404) nhưng API thường vẫn chạy',
      async (raw) => {
        const app = await buildApp();
        expect(setupSwagger(app, raw)).toBe(false);
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

    it.each([['true'], ['1'], ['yes'], ['on'], [' TRUE\r'], [true]])(
      'CRM_SWAGGER_ENABLED=%j: có route docs, docs-json và docs-yaml mô tả API',
      async (raw) => {
        const app = await buildApp();
        expect(setupSwagger(app, raw)).toBe(true);
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

    it('không phụ thuộc NODE_ENV: production + cờ true vẫn mở, development + cờ false vẫn 404', async () => {
      const original = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const on = await buildApp();
        expect(setupSwagger(on, 'true')).toBe(true);
        await on.init();
        await on.getHttpAdapter().getInstance().ready();
        const opened = await on.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}-json`,
        });
        expect(opened.statusCode).toBe(200);
        await on.close();

        process.env.NODE_ENV = 'development';
        const off = await buildApp();
        expect(setupSwagger(off, 'false')).toBe(false);
        await off.init();
        await off.getHttpAdapter().getInstance().ready();
        const closed = await off.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}-json`,
        });
        expect(closed.statusCode).toBe(404);
        await off.close();
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });

  describe('setupSwaggerFromConfig (dây main.ts -> CRM_SWAGGER_ENABLED)', () => {
    it('đọc đúng khóa CRM_SWAGGER_ENABLED từ cấu hình và bật Swagger khi truthy', async () => {
      const get = jest.fn().mockReturnValue('true');
      const app = await buildApp();

      const result = setupSwaggerFromConfig(app, { get });

      expect(get).toHaveBeenCalledWith('CRM_SWAGGER_ENABLED');
      expect(result).toEqual({ flag: 'true', isOn: true });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const opened = await app.inject({
        method: 'GET',
        url: `/${SWAGGER_PATH}-json`,
      });
      expect(opened.statusCode).toBe(200);
      await app.close();
    });

    it.each([[undefined], [''], ['0'], ['abc']])(
      'cờ %p => tắt, trả lại cờ thô để log và /docs-json 404',
      async (flag) => {
        const app = await buildApp();

        const result = setupSwaggerFromConfig(app, {
          get: jest.fn().mockReturnValue(flag),
        });

        expect(result).toEqual({ flag, isOn: false });
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
        const closed = await app.inject({
          method: 'GET',
          url: `/${SWAGGER_PATH}-json`,
        });
        expect(closed.statusCode).toBe(404);
        await app.close();
      },
    );
  });
});
