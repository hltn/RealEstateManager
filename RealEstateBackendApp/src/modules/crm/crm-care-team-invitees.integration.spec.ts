/**
 * INTEGRATION — `GET /crm/care-team-invitees` (T-15, FR-13/FR-14, Architecture mục 4). HTTP thật (Fastify + guard toàn cục
 * + MongoDB Replica Set in-memory). Kiểm điều unit test mock không chứng minh được: nối dây module (DI), quyền theo vai
 * trò thật, filter chạy trên Mongo thật (ACTIVE/BLOCKED/xóa mềm/role/careTeam), sắp xếp theo `displayName`, tên nhóm,
 * hình dạng response không lộ trường nhạy cảm, `limit > 20` ⇒ 400, rate-limit `INVITEE_SEARCH` qua `CrmRateLimitService` thật.
 *
 * Các `it` dùng chung dữ liệu và chạy THEO THỨ TỰ. Chạy bằng `npm run test:integration`.
 */
import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmRateLimitService } from './common/security/crm-rate-limit.service';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

type Res = { status: number; body: any };

describe('care-team-invitees — HTTP + MongoDB Replica Set', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    as: string,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${tokens[as]}` },
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const createUser = async (
    key: string,
    role: UserRole,
    extra: Record<string, unknown> = {},
  ) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      roles: [role],
      status: UserStatus.ACTIVE,
      ...extra,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({
      sub: ids[key],
      email: `${key}@test.vn`,
      role,
      roles: [role],
    });
  };

  let phoneSeq = 0;
  /** Khách do `as` tạo (người tạo là PRIMARY, T-07). */
  const createCustomer = async (as: string): Promise<string> => {
    const phone = `091${String(4_000_000 + ++phoneSeq)}`;
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const invitees = (as: string, qs = '') =>
    call('GET', `/crm/care-team-invitees${qs}`, as);
  const names = (res: Res): string[] =>
    res.body.data.map((u: { displayName: string }) => u.displayName);

  const rateLimitProto = CrmRateLimitService.prototype as {
    consume: CrmRateLimitService['consume'];
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-invitees-${RUN_ID}:`;
    replSet = await createMemoryReplSet();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        FeatureFlagModule,
        UsersModule,
        TeamsModule,
        CrmModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
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
    userModel = app.get(getModelToken(User.name));
    jwt = app.get(JwtService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    const teams = connection.collection('teams');
    const [teamA, teamB] = await Promise.all(
      ['Nhóm A', 'Nhóm B'].map((name, index) =>
        teams.insertOne({ name, code: `INV${index}`, deletedAt: null }),
      ),
    );
    ids.teamA = String(teamA.insertedId);
    ids.teamB = String(teamB.insertedId);

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('mgr', UserRole.MANAGER, {
      teamIds: [teamA.insertedId],
    });
    // Tên bắt đầu bằng chữ khác nhau để kiểm thứ tự sắp xếp.
    await createUser('staffP', UserRole.STAFF, { teamIds: [teamA.insertedId] });
    await createUser('staffQ', UserRole.STAFF, {
      teamIds: [teamA.insertedId, teamB.insertedId],
    });
    await createUser('staffR', UserRole.STAFF, { teamIds: [teamB.insertedId] });
    await createUser('staffNoTeam', UserRole.STAFF);
    await createUser('staffBlocked', UserRole.STAFF, {
      status: UserStatus.BLOCKED,
    });
    await createUser('staffDeleted', UserRole.STAFF, {
      deletedAt: new Date(),
    });
    await createUser('mgr2', UserRole.MANAGER);
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // Redis không có ở máy dev: mọi ca dùng stub; ca rate-limit thật dùng `eval` giả ở describe riêng.
  describe('Chức năng', () => {
    beforeEach(() => {
      jest.spyOn(rateLimitProto, 'consume').mockResolvedValue(undefined);
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('Admin/Manager không customerId: chỉ ACTIVE Manager/Staff chưa xóa mềm, không có chính mình/Admin/Editor/BLOCKED/xóa mềm', async () => {
      const res = await invitees('admin', '?limit=20');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual([
        'mgr',
        'mgr2',
        'staffNoTeam',
        'staffP',
        'staffQ',
        'staffR',
      ]);
      expect(res.body.meta).toMatchObject({ total: 6, page: 1, limit: 20 });

      const asMgr = await invitees('mgr', '?limit=20');
      expect(asMgr.status).toBe(200);
      expect(names(asMgr)).not.toContain('mgr');
      expect(names(asMgr)).toHaveLength(5);
    });

    it('response chỉ có id, displayName, teamNames (tên nhóm); không email/SĐT/role/id nhóm', async () => {
      const res = await invitees('admin', '?q=staffQ');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const item = res.body.data[0] as { id: string; teamNames: string[] };
      expect(Object.keys(item).sort()).toEqual([
        'displayName',
        'id',
        'teamNames',
      ]);
      expect(item.id).toBe(ids.staffQ);
      expect([...item.teamNames].sort()).toEqual(['Nhóm A', 'Nhóm B']);
      expect(JSON.stringify(res.body)).not.toContain('@test.vn');
      expect(JSON.stringify(res.body)).not.toContain(ids.teamA);
    });

    it('người chưa có nhóm ⇒ teamNames rỗng; q không phân biệt hoa/thường; q chứa ký tự regex không lỗi và không khớp bừa', async () => {
      const res = await invitees('admin', '?q=STAFFNOTEAM');
      expect(names(res)).toEqual(['staffNoTeam']);
      expect(res.body.data[0].teamNames).toEqual([]);

      for (const q of ['.*', '(', '[a-z]', 'staff%2B']) {
        const regexRes = await invitees('admin', `?q=${q}`);
        expect(regexRes.status).toBe(200);
        expect(regexRes.body.data).toHaveLength(0);
      }
    });

    it('phân trang: limit 2 trang 2, total đúng; limit > 20 ⇒ 400; q > 50 ký tự ⇒ 400; customerId sai định dạng ⇒ 400', async () => {
      const page2 = await invitees('admin', '?limit=2&page=2');
      expect(page2.status).toBe(200);
      expect(names(page2)).toEqual(['staffNoTeam', 'staffP']);
      expect(page2.body.meta).toMatchObject({
        total: 6,
        page: 2,
        limit: 2,
        totalPages: 3,
      });

      expect((await invitees('admin', '?limit=21')).status).toBe(400);
      expect((await invitees('admin', `?q=${'a'.repeat(51)}`)).status).toBe(
        400,
      );
      expect((await invitees('admin', '?customerId=abc')).status).toBe(400);
    });

    it('có customerId: Admin/Manager thấy danh sách đã loại người trong careTeam và chính mình; khách ngoài phạm vi/không tồn tại ⇒ 404', async () => {
      const customerId = await createCustomer('staffP');
      const invited = await call(
        'POST',
        `/crm/customers/${customerId}/care-team/members`,
        'admin',
        { userIds: [ids.staffR] },
      );
      expect(invited.status).toBe(201);

      const res = await invitees('admin', `?customerId=${customerId}&limit=20`);
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['mgr', 'mgr2', 'staffNoTeam', 'staffQ']);

      const missing = await invitees(
        'admin',
        `?customerId=${String(new Types.ObjectId())}`,
      );
      expect(missing.status).toBe(404);
      expect(missing.body.errorCode).toBe('CUSTOMER_NOT_FOUND');
    });

    it('Staff: PRIMARY của khách được xem (loại chính mình + người trong nhóm); MEMBER, không phải thành viên, hoặc không customerId ⇒ 403/404', async () => {
      const customerId = await createCustomer('staffP');
      await call(
        'POST',
        `/crm/customers/${customerId}/care-team/members`,
        'staffP',
        { userIds: [ids.staffR] },
      );

      const asPrimary = await invitees(
        'staffP',
        `?customerId=${customerId}&limit=20`,
      );
      expect(asPrimary.status).toBe(200);
      expect(names(asPrimary)).not.toContain('staffP');
      expect(names(asPrimary)).not.toContain('staffR');
      expect(names(asPrimary)).toContain('staffQ');

      const asMember = await invitees('staffR', `?customerId=${customerId}`);
      expect(asMember.status).toBe(403);
      expect(asMember.body.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');

      const outsider = await invitees(
        'staffNoTeam',
        `?customerId=${customerId}`,
      );
      expect(outsider.status).toBe(404);
      expect(outsider.body.errorCode).toBe('CUSTOMER_NOT_FOUND');

      const noCustomer = await invitees('staffP');
      expect(noCustomer.status).toBe(403);
      expect(noCustomer.body.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');
    });

    it('Manager ngoài phạm vi (không quản lý nhóm của khách, không trong careTeam) ⇒ 404 CUSTOMER_NOT_FOUND', async () => {
      // Khách của staffR (nhóm B); mgr2 không quản lý nhóm nào và không nằm trong careTeam.
      const customerId = await createCustomer('staffR');

      const res = await invitees('mgr2', `?customerId=${customerId}`);
      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('CUSTOMER_NOT_FOUND');
    });

    it('Editor (không thuộc CRM_ROLES) ⇒ 403', async () => {
      expect((await invitees('editor')).status).toBe(403);
    });
  });

  describe('Swagger', () => {
    it('có route GET /api/v1/crm/care-team-invitees', () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('qa').addBearerAuth().build(),
      );
      const route = doc.paths['/api/v1/crm/care-team-invitees'];
      expect(route).toBeDefined();
      expect(Object.keys(route)).toEqual(['get']);
    });
  });

  describe('Rate limit INVITEE_SEARCH (FR-14)', () => {
    it('CrmRateLimitService THẬT qua HTTP: lượt thứ 60 qua, lượt thứ 61 ⇒ 429 RATE_LIMITED + retryAfterSeconds, khóa theo INVITEE_SEARCH và người dùng', async () => {
      const redis = app.get<{ eval: (...args: unknown[]) => Promise<unknown> }>(
        REDIS_CLIENT,
      );
      let nextCount = 60;
      const evalSpy = jest
        .spyOn(redis, 'eval')
        .mockImplementation(() => Promise.resolve([nextCount, 42_000]));
      try {
        const atLimit = await invitees('admin');
        nextCount = 61;
        const overLimit = await invitees('admin');

        expect(atLimit.status).toBe(200);
        expect(overLimit.status).toBe(429);
        expect(overLimit.body.errorCode).toBe('RATE_LIMITED');
        expect(overLimit.body.details).toEqual({ retryAfterSeconds: 42 });
        expect(evalSpy).toHaveBeenLastCalledWith(
          expect.any(String),
          1,
          `crm:rl:INVITEE_SEARCH:${ids.admin}`,
          60_000,
        );
      } finally {
        evalSpy.mockRestore();
      }
    });

    it('Redis lỗi ⇒ 503 (fail-closed)', async () => {
      const redis = app.get<{ eval: (...args: unknown[]) => Promise<unknown> }>(
        REDIS_CLIENT,
      );
      const evalSpy = jest
        .spyOn(redis, 'eval')
        .mockRejectedValue(new Error('redis down'));
      try {
        expect((await invitees('admin')).status).toBe(503);
      } finally {
        evalSpy.mockRestore();
      }
    });
  });
});
