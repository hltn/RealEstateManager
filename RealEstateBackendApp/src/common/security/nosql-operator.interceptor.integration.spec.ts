/**
 * INTEGRATION nhẹ — NoSqlOperatorInterceptor (FR-14, PT-037) trên Fastify thật cùng guard giả,
 * ValidationPipe toàn cục (whitelist/forbidNonWhitelisted/transform) và GlobalExceptionFilter.
 * Không cần Mongo. Xác nhận: thứ tự guard, interceptor, pipe; format lỗi `VALIDATION_FAILED`;
 * các dạng đã có 400 từ trước (`$ne`/`$regex`/`$in`, `actions[$ne]`, body PATCH) vẫn 400.
 */
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import { Test } from '@nestjs/testing';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { NoSqlOperatorInterceptor } from './nosql-operator.interceptor';

class ListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}

class UpdateDto {
  @IsOptional()
  @IsString()
  fullName?: string;
}

class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
    }>();
    if (req.headers['x-auth'] !== 'yes') throw new UnauthorizedException();
    return true;
  }
}

@Controller('probe')
@UseGuards(FakeAuthGuard)
class ProbeController {
  @Get('list')
  list(@Query() q: ListQueryDto) {
    return { q: q.q ?? null };
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: UpdateDto) {
    return { id, body };
  }

  @Post('free')
  free(@Body() body: Record<string, unknown>) {
    return { ok: true, keys: Object.keys(body) };
  }

  @Post('upload')
  upload() {
    return { uploaded: true };
  }
}

@Module({
  controllers: [ProbeController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: NoSqlOperatorInterceptor }],
})
class ProbeModule {}

const REJECT_MESSAGE = 'Dữ liệu chứa ký tự/toán tử không được phép';

describe('NoSqlOperatorInterceptor tích hợp (FR-14)', () => {
  let app: NestFastifyApplication;
  const headers = { 'x-auth': 'yes' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');
    await app.register(fastifyMultipart);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('FR-14: request hợp lệ vẫn 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/probe/list?q=abc',
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ q: 'abc' });
  });

  it.each([
    ['q[$ne]', '/api/v1/probe/list?q[$ne]=x'],
    ['q[$regex]', '/api/v1/probe/list?q[$regex]=.*'],
    ['actions[$ne] (histories)', '/api/v1/probe/list?actions[$ne]=x'],
    ['actions[$in]', '/api/v1/probe/list?actions[$in]=x'],
    ['khóa chứa dấu chấm', '/api/v1/probe/list?a.b=x'],
  ])('FR-14: query %s trả 400 VALIDATION_FAILED', async (_name, url) => {
    const res = await app.inject({ method: 'GET', url, headers });
    expect(res.statusCode).toBe(400);
    const json = res.json<{ errorCode: string; message: string }>();
    expect(json.errorCode).toBe('VALIDATION_FAILED');
    expect(json.message).toBe(REJECT_MESSAGE);
  });

  it('FR-14: PATCH body chứa `$ne` trả 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/probe/507f1f77bcf86cd799439011',
      headers,
      payload: { fullName: { $ne: null } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errorCode: string }>().errorCode).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('FR-14: body tự do chứa `$gt` lồng sâu bị chặn, khóa có `.` ở body vẫn qua', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/probe/free',
      headers,
      payload: { cfg: { list: [{ x: { $gt: 1 } }] } },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/probe/free',
      headers,
      payload: { crawlConfig: { 'a.b': 1 } },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('FR-14: guard chạy TRƯỚC interceptor (chưa đăng nhập kèm `$` vẫn nhận 401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/probe/list?q[$ne]=x',
    });
    expect(res.statusCode).toBe(401);
  });

  it('FR-14: interceptor chạy TRƯỚC ValidationPipe (lỗi là thông báo chặn, không phải lỗi DTO)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/probe/list?unknownField=1&q[$ne]=x',
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toBe(REJECT_MESSAGE);
  });

  it('FR-14: upload multipart không bị chặn', async () => {
    const boundary = 'xBOUNDARYx';
    const payload =
      `--${boundary}\r\nContent-Disposition: form-data; name="$weird"; filename="a.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe/upload',
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(201);
  });
});
