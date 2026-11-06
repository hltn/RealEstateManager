/**
 * INTEGRATION — FR-22: hai `POST /users` đồng thời cùng email → đúng một 201 và một 409, không 500.
 * AuthModule + UsersModule thật trên MongoDB Replica Set in-memory; unique index {email, deletedAt} là chốt chặn race.
 */
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { createRedisClientStub } from '../../shared/redis/redis-client.fixture';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from './users.module';

jest.setTimeout(240_000);

const PASSWORD = 'Start@123456';

describe('FR-22: POST /users đồng thời cùng email (AuthModule + UsersModule thật)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let adminToken: string;

  const createUser = async (body: Record<string, unknown>) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: body as never,
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  const countByEmail = (email: string) =>
    connection.collection('users').countDocuments({ email });

  beforeAll(async () => {
    process.env.AUTH_LOGIN_THROTTLE_LIMIT = '10000';
    replSet = await createMemoryReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'qa-users-race-secret' })],
        }),
        MongooseModule.forRoot(replSet.getUri()),
        FeatureFlagModule,
        AuthModule,
        UsersModule,
      ],
    })
      // Không cần Redis thật: NotificationsModule kéo theo RedisModule, tránh tự kết nối Redis của máy.
      .overrideProvider(REDIS_CLIENT)
      .useValue(createRedisClientStub())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    const fastify = app.getHttpAdapter().getInstance() as unknown as {
      decorateReply: (name: string, value: unknown) => void;
      decorateRequest: (name: string, value: unknown) => void;
      addHook: (
        name: 'onRequest',
        fn: (req: any, reply: unknown, done: () => void) => void,
      ) => void;
    };
    fastify.decorateReply('setCookie', function (this: unknown) {
      return this;
    });
    fastify.decorateReply('clearCookie', function (this: unknown) {
      return this;
    });
    fastify.decorateRequest('cookies', null);
    fastify.addHook('onRequest', (req, _reply, done) => {
      req.cookies = {};
      done();
    });
    app.setGlobalPrefix('api/v1');
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
    connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );

    await connection.collection('users').insertOne({
      email: 'admin@race.test',
      password: await argon2.hash(PASSWORD),
      displayName: 'Admin',
      role: 'ADMIN',
      roles: ['ADMIN'],
      status: 'ACTIVE',
      teamId: null,
      teamIds: [],
      deletedAt: null,
      lastLoginAt: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@race.test', password: PASSWORD },
    });
    adminToken = JSON.parse(res.body).accessToken;
  });

  afterAll(async () => {
    delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
    await app?.close();
    await replSet?.stop();
  });

  it('FR-22: nhánh không teamIds — 2 POST đồng thời cùng email → một 201, một 409, DB chỉ một bản ghi', async () => {
    const body = {
      email: 'race1@race.test',
      password: 'Editor@123456',
      displayName: 'Race One',
      role: 'EDITOR',
    };
    const results = await Promise.all([createUser(body), createUser(body)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countByEmail('race1@race.test')).toBe(1);
  });

  it('FR-22: nhánh có teamIds — 2 POST đồng thời cùng email → một 201, một 409, không 500', async () => {
    const { insertedId } = await connection.collection('teams').insertOne({
      name: 'Race Team',
      isActive: true,
      deletedAt: null,
      managerIds: [],
      revision: 0,
    });
    const body = {
      email: 'race2@race.test',
      password: 'Staff@123456',
      displayName: 'Race Two',
      role: 'STAFF',
      teamIds: [insertedId.toHexString()],
    };
    const results = await Promise.all([createUser(body), createUser(body)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countByEmail('race2@race.test')).toBe(1);
  });

  it('FR-22: email trùng tuần tự (đi qua kiểm trước) vẫn 409 cùng thông điệp', async () => {
    const body = {
      email: 'race3@race.test',
      password: 'Editor@123456',
      displayName: 'Race Three',
      role: 'EDITOR',
    };
    expect((await createUser(body)).status).toBe(201);
    const second = await createUser(body);

    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('Email already in use');
  });
});
