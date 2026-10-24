/**
 * INTEGRATION — CRM M2 (khách hàng lõi) qua HTTP thật: Fastify + ValidationPipe + GlobalExceptionFilter +
 * JwtAuthGuard/RolesGuard + CrmFeatureGuard trên MongoDB Replica Set thật (mongodb-memory-server) và Redis THẬT
 * (idempotency + rate limit; `docker compose -f docker-compose.dev.yml up -d --wait`, key có tiền tố riêng mỗi lần chạy).
 *
 * Các `it` trong cùng file chạy THEO THỨ TỰ và dùng chung dữ liệu dựng ở `beforeAll`/các bước trước.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
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
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { PiiCryptoService } from './common/crypto/pii-crypto.service';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(300_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

interface Res {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

describe('CRM M2 — khách hàng lõi (HTTP + Replica Set + Redis)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let pii: PiiCryptoService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const status: Record<string, string> = {};

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    as: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
        ...headers,
      },
      payload: body as never,
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return {
      status: res.statusCode,
      body: parsed,
      headers: res.headers,
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
      role,
      status: UserStatus.ACTIVE,
      ...extra,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

  let phoneSeq = 0;
  /** SĐT VN hợp lệ, duy nhất theo thứ tự gọi. */
  const nextPhone = () => `091${String(1_000_000 + ++phoneSeq)}`;

  const createCustomer = async (
    as: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; phone: string; res: Res }> => {
    const phone = nextPhone();
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
      ...extra,
    });
    expect(res.status).toBe(201);
    return { id: res.body.data.id, phone, res };
  };

  const listIds = async (as: string, query = ''): Promise<string[]> => {
    const res = await call('GET', `/crm/customers?limit=100${query}`, as);
    expect(res.status).toBe(200);
    return res.body.data.map((item: { id: string }) => item.id);
  };

  const auditOf = (customerId: string, action?: string) =>
    connection
      .collection('crm_audit_logs')
      .find({
        customerId: new Types.ObjectId(customerId),
        ...(action ? { action } : {}),
      })
      .sort({ _id: 1 })
      .toArray();

  const customers = () => connection.collection('customers');

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-m2-${RUN_ID}:`;
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

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
    pii = app.get(PiiCryptoService);

    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();
    for (const row of await connection
      .collection('customer_statuses')
      .find({})
      .toArray()) {
      status[row.code as string] = String(row._id);
    }

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('manager2', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('staffD', UserRole.STAFF);
    await createUser('blockedStaff', UserRole.STAFF, {
      status: UserStatus.BLOCKED,
    });

    const teamA = await call('POST', '/teams', 'admin', {
      name: 'Nhóm A',
      code: 'TEAMA',
      managerIds: [ids.manager1],
    });
    const teamB = await call('POST', '/teams', 'admin', {
      name: 'Nhóm B',
      code: 'TEAMB',
      managerIds: [ids.manager2],
    });
    ids.teamA = teamA.body.data.id;
    ids.teamB = teamB.body.data.id;
    for (const [user, team] of [
      ['manager1', 'teamA'],
      ['staffA', 'teamA'],
      ['staffB', 'teamA'],
      ['manager2', 'teamB'],
      ['staffC', 'teamB'],
    ]) {
      const res = await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
        teamId: ids[team],
      });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------------------------
  describe('Tạo khách + phạm vi theo vai trò', () => {
    let c1: string; // staffA tạo (nhóm A)
    let c2: string; // admin tạo, giao staffC (nhóm B)
    let c3: string; // manager1 tạo, giao staffB (nhóm A)

    it('Nhân viên tạo => tự là phụ trách chính; teamIds = nhóm của họ; audit CUSTOMER_CREATED ghi vai trò/tên lấy từ DB', async () => {
      // Token cũ còn ghi ADMIN nhưng DB là STAFF: audit phải ghi STAFF (không tin JWT).
      const stale = jwt.sign({
        sub: ids.staffA,
        email: 'staffA@test.vn',
        role: UserRole.ADMIN,
      });
      const phone = nextPhone();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm/customers',
        headers: { authorization: `Bearer ${stale}` },
        payload: { fullName: 'Nguyễn Văn An', phone, email: 'An@Example.com' },
      });
      // Role ADMIN trong token không mở được route CRM ngoài phạm vi vì phạm vi lấy từ DB:
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body).data;
      c1 = body.id;

      expect(body).toMatchObject({
        fullName: 'Nguyễn Văn An',
        email: 'an@example.com',
        progress: 0,
        version: 0,
        createdVia: 'WEB',
        primaryAssignee: { id: ids.staffA, displayName: 'staffA' },
        status: { id: status.NOT_CONTACTED, listGroup: 'NOT_CONTACTED' },
      });
      expect(body.careTeam).toHaveLength(1);
      expect(body.careTeam[0]).toMatchObject({ role: 'PRIMARY' });
      expect(body.phoneMasked).toMatch(/^0911 ••• \d{3}$/);
      expect(JSON.stringify(body)).not.toContain(phone);

      const stored = await customers().findOne({ _id: new Types.ObjectId(c1) });
      expect(stored?.phone).toBe(`+84${phone.slice(1)}`);
      expect(stored?.teamIds.map(String)).toEqual([ids.teamA]);
      const [audit] = await auditOf(c1, 'CUSTOMER_CREATED');
      expect(audit).toMatchObject({
        actorId: new Types.ObjectId(ids.staffA),
        actorRole: 'STAFF',
        actorName: 'staffA',
        entityType: 'CUSTOMER',
      });
      expect(audit.requestId).toBeTruthy();
      // SĐT trong audit lúc tạo bị che.
      expect(JSON.stringify(audit.changes)).not.toContain(phone.slice(4));
    });

    it('Quản trị/Quản lý chỉ định careTeam; Nhân viên không được; người được phân phải hợp lệ và thuộc nhóm Quản lý quản lý', async () => {
      const asAdmin = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffC },
      });
      c2 = asAdmin.id;
      expect(asAdmin.res.body.data.primaryAssignee.id).toBe(ids.staffC);
      expect(
        (
          await customers().findOne({ _id: new Types.ObjectId(c2) })
        )?.teamIds.map(String),
      ).toEqual([ids.teamB]);

      const asManager = await createCustomer('manager1', {
        careTeam: { memberIds: [ids.staffA], primaryUserId: ids.staffB },
      });
      c3 = asManager.id;
      expect(asManager.res.body.data.careTeam).toHaveLength(2);

      const staffAssigns = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'X',
        phone: nextPhone(),
        careTeam: { memberIds: [], primaryUserId: ids.staffB },
      });
      expect(staffAssigns.status).toBe(403);
      expect(staffAssigns.body.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');

      // manager1 không được phân người của nhóm B; người bị khóa/EDITOR cũng không hợp lệ.
      for (const user of ['staffC', 'blockedStaff', 'editor']) {
        const res = await call('POST', '/crm/customers', 'manager1', {
          fullName: 'X',
          phone: nextPhone(),
          careTeam: { memberIds: [], primaryUserId: ids[user] },
        });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('USER_NOT_ASSIGNABLE');
      }
    });

    it('Quản lý tạo không chỉ định careTeam: khách thuộc nhóm mình quản lý và chính họ thấy được; Quản lý không quản lý nhóm nào => 400 PRIMARY_REQUIRED', async () => {
      const own = await createCustomer('manager2');
      expect(await listIds('manager2')).toContain(own.id);

      await createUser('lonelyManager', UserRole.MANAGER);
      const res = await call('POST', '/crm/customers', 'lonelyManager', {
        fullName: 'Y',
        phone: nextPhone(),
      });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PRIMARY_REQUIRED');
    });

    it('ma trận xem: Quản trị thấy tất cả; Quản lý theo nhóm quản lý; Nhân viên theo careTeam; EDITOR 403', async () => {
      const admin = await listIds('admin');
      for (const id of [c1, c2, c3]) expect(admin).toContain(id);

      const manager1 = await listIds('manager1');
      expect(manager1).toEqual(expect.arrayContaining([c1, c3]));
      expect(manager1).not.toContain(c2);

      const manager2 = await listIds('manager2');
      expect(manager2).toContain(c2);
      expect(manager2).not.toContain(c1);
      expect(manager2).not.toContain(c3);

      expect(await listIds('staffA')).toEqual(expect.arrayContaining([c1, c3]));
      expect(await listIds('staffA')).not.toContain(c2);
      const staffB = await listIds('staffB');
      expect(staffB).toContain(c3);
      expect(staffB).not.toContain(c1);
      expect(await listIds('staffD')).toEqual([]);

      expect((await call('GET', '/crm/customers', 'editor')).status).toBe(403);
      expect((await call('GET', '/crm/customers', null)).status).toBe(401);
    });

    it('ngoài phạm vi: mọi endpoint theo :id trả 404 CUSTOMER_NOT_FOUND (không phải 403) cho Nhân viên và Quản lý', async () => {
      const probes: Array<[Parameters<typeof call>[0], string, unknown]> = [
        ['GET', `/crm/customers/${c1}`, undefined],
        ['PATCH', `/crm/customers/${c1}`, { version: 0, fullName: 'Z' }],
        [
          'PATCH',
          `/crm/customers/${c1}/status`,
          { statusId: status.NET, version: 0 },
        ],
        [
          'PATCH',
          `/crm/customers/${c1}/criteria`,
          { version: 0, demand: { isDone: true } },
        ],
        ['PUT', `/crm/customers/${c1}/data-consent`, { status: 'GRANTED' }],
        [
          'PUT',
          `/crm/customers/${c1}/national-id`,
          { nationalId: '012345678901' },
        ],
        ['DELETE', `/crm/customers/${c1}/national-id`, undefined],
        ['POST', `/crm/customers/${c1}/national-id-views`, {}],
        ['POST', `/crm/customers/${c1}/phone-views`, { purpose: 'VIEW' }],
        ['GET', `/crm/customers/${c1}/histories`, undefined],
      ];
      for (const [method, url, body] of probes) {
        for (const who of ['staffB', 'staffD', 'manager2']) {
          const res = await call(method, url, who, body);
          expect([method, url, who, res.status]).toEqual([
            method,
            url,
            who,
            404,
          ]);
          expect(res.body.errorCode).toBe('CUSTOMER_NOT_FOUND');
        }
      }
      for (const who of ['staffB', 'manager2']) {
        const res = await call('DELETE', `/crm/customers/${c1}?reason=x`, who);
        // STAFF không có quyền xóa (403 trước); Quản lý ngoài phạm vi => 404.
        expect(res.status).toBe(who === 'staffB' ? 403 : 404);
      }
      const ids404 = await call('GET', '/crm/customers/not-an-id', 'admin');
      expect(ids404.status).toBe(400);
    });

    it('trùng SĐT (mọi cách viết) => 409 CUSTOMER_PHONE_DUPLICATED; người ngoài phạm vi chỉ biết "do [tên] chăm sóc"; có audit PHONE_LOOKUP', async () => {
      const stored = (await customers().findOne({
        _id: new Types.ObjectId(c1),
      }))!;
      const national = `0${String(stored.phone).slice(3)}`;
      const spaced = `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;

      const outsider = await call('POST', '/crm/customers', 'staffC', {
        fullName: 'Trùng',
        phone: spaced,
      });
      expect(outsider.status).toBe(409);
      expect(outsider.body.errorCode).toBe('CUSTOMER_PHONE_DUPLICATED');
      expect(outsider.body.details).toMatchObject({
        caredByName: 'staffA',
        customerRef: c1,
        canRequestJoin: true,
        isAccessible: false,
      });
      expect(outsider.body.message).toContain('staffA');
      expect(JSON.stringify(outsider.body)).not.toContain('Nguyễn Văn An');

      const insider = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'Trùng',
        phone: `+84${national.slice(1)}`,
      });
      expect(insider.status).toBe(409);
      expect(insider.body.details).toMatchObject({
        isAccessible: true,
        customerId: c1,
      });
      expect(
        (await auditOf(c1, 'PHONE_LOOKUP')).map((row) => String(row.actorId)),
      ).toEqual([ids.staffC]);
    });

    it('race: 6 yêu cầu tạo cùng SĐT đồng thời => đúng 1 khách được tạo, còn lại 409 (unique index, không dựa kiểm tra trước)', async () => {
      const phone = nextPhone();
      const results = await Promise.all(
        ['staffA', 'staffB', 'staffC', 'manager1', 'admin', 'staffA'].map(
          (who) =>
            call('POST', '/crm/customers', who, { fullName: 'Race', phone }),
        ),
      );
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(
        await customers().countDocuments({
          phone: `+84${phone.slice(1)}`,
        }),
      ).toBe(1);
      // Khách thua cuộc không để lại audit CUSTOMER_CREATED (transaction rollback).
      const created = await customers().findOne({
        phone: `+84${phone.slice(1)}`,
      });
      expect(
        await auditOf(String(created!._id), 'CUSTOMER_CREATED'),
      ).toHaveLength(1);
    });

    it('validate: SĐT sai => 400 INVALID_PHONE; email sai/ID danh mục lạ/field thừa => 400; null cho field bắt buộc ở PATCH => 400', async () => {
      const bad = await call('POST', '/crm/customers', 'admin', {
        fullName: 'A',
        phone: '123',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe('INVALID_PHONE');
      for (const body of [
        { fullName: 'A', phone: nextPhone(), email: 'khong-phai-email' },
        { fullName: 'A', phone: nextPhone(), tagIds: ['khong-phai-id'] },
        { fullName: 'A', phone: nextPhone(), customerCode: 'X1' },
      ]) {
        expect(
          (await call('POST', '/crm/customers', 'admin', body)).status,
        ).toBe(400);
      }
      const unknownSource = await call('POST', '/crm/customers', 'admin', {
        fullName: 'A',
        phone: nextPhone(),
        sourceId: new Types.ObjectId().toHexString(),
      });
      expect(unknownSource.status).toBe(400);
      expect(unknownSource.body.errorCode).toBe('VALIDATION_FAILED');

      const detail = await call('GET', `/crm/customers/${c1}`, 'staffA');
      for (const body of [
        { version: detail.body.data.version, fullName: null },
        { version: detail.body.data.version, phone: null },
        { version: detail.body.data.version, interestedProjectIds: null },
        { fullName: 'thiếu version' },
      ]) {
        expect(
          (await call('PATCH', `/crm/customers/${c1}`, 'staffA', body)).status,
        ).toBe(400);
      }
      expect(
        (
          await call('PATCH', `/crm/customers/${c1}/criteria`, 'staffA', {
            version: 0,
            demand: null,
          })
        ).status,
      ).toBe(400);
    });

    it('idempotency gắn theo NGƯỜI DÙNG: cùng key + cùng user => cùng kết quả (1 khách); cùng key khác user => xử lý độc lập', async () => {
      const key = `key-${RUN_ID}`;
      const phoneA = nextPhone();
      const first = await call(
        'POST',
        '/crm/customers',
        'staffA',
        { fullName: 'Idem', phone: phoneA },
        { 'x-idempotency-key': key },
      );
      const replay = await call(
        'POST',
        '/crm/customers',
        'staffA',
        { fullName: 'Idem', phone: phoneA },
        { 'x-idempotency-key': key },
      );
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(
        await customers().countDocuments({ phone: `+84${phoneA.slice(1)}` }),
      ).toBe(1);

      // staffB dùng đúng key đó với SĐT khác: không được nhận lại response của staffA.
      const other = await call(
        'POST',
        '/crm/customers',
        'staffB',
        { fullName: 'Idem B', phone: nextPhone() },
        { 'x-idempotency-key': key },
      );
      expect(other.status).toBe(201);
      expect(other.body.data.id).not.toBe(first.body.data.id);
      expect(other.body.data.fullName).toBe('Idem B');

      // Click đúp đồng thời: không tạo 2 khách.
      const dbl = nextPhone();
      const results = await Promise.all(
        [1, 2].map(() =>
          call(
            'POST',
            '/crm/customers',
            'staffA',
            { fullName: 'Dbl', phone: dbl },
            { 'x-idempotency-key': `dbl-${RUN_ID}` },
          ),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await customers().countDocuments({ phone: `+84${dbl.slice(1)}` }),
      ).toBe(1);
    });

    it('lưu lại id cho các nhóm test sau', () => {
      ids.c1 = c1;
      ids.c2 = c2;
      ids.c3 = c3;
      expect(c1 && c2 && c3).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('phone-lookups', () => {
    it('chưa có / trong phạm vi / ngoài phạm vi; người tra thấy khác nhau theo vai trò; SĐT sai 400', async () => {
      const fresh = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'staffA',
        {
          phone: '0987 000 111',
        },
      );
      expect(fresh.status).toBe(200);
      expect(fresh.body.data).toMatchObject({
        normalizedPhone: '+84987000111',
        exists: false,
        isAccessible: false,
        canRequestJoin: false,
      });

      const stored = (await customers().findOne({
        _id: new Types.ObjectId(ids.c1),
      }))!;
      const mine = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'staffA',
        {
          phone: stored.phone,
        },
      );
      expect(mine.body.data).toMatchObject({
        exists: true,
        isAccessible: true,
        customerId: ids.c1,
      });

      const theirs = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'staffC',
        {
          phone: stored.phone,
        },
      );
      expect(theirs.body.data).toMatchObject({
        exists: true,
        isAccessible: false,
        customerRef: ids.c1,
        caredByName: 'staffA',
        canRequestJoin: true,
        hasPendingRequest: false,
      });
      expect(theirs.body.data.customerId).toBeUndefined();

      const asAdmin = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'admin',
        {
          phone: stored.phone,
        },
      );
      expect(asAdmin.body.data).toMatchObject({
        isAccessible: true,
        canRequestJoin: false,
        isDeleted: false,
      });

      const invalid = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'staffA',
        {
          phone: 'abc',
        },
      );
      expect(invalid.status).toBe(400);
      expect(invalid.body.errorCode).toBe('INVALID_PHONE');
      expect(
        (
          await call('POST', '/crm/customers/phone-lookups', 'editor', {
            phone: stored.phone,
          })
        ).status,
      ).toBe(403);
    });

    it('rate limit 30 lần/phút/người => 429 RATE_LIMITED { retryAfterSeconds }, người khác không bị ảnh hưởng', async () => {
      await createUser('prober', UserRole.STAFF);
      let limited: Res | undefined;
      for (let attempt = 1; attempt <= 31; attempt += 1) {
        const res = await call(
          'POST',
          '/crm/customers/phone-lookups',
          'prober',
          {
            phone: '0987000222',
          },
        );
        if (res.status === 429) {
          limited = res;
          expect(attempt).toBe(31);
          break;
        }
      }
      expect(limited?.body.errorCode).toBe('RATE_LIMITED');
      expect(limited?.body.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(
        (
          await call('POST', '/crm/customers/phone-lookups', 'staffD', {
            phone: '0987000222',
          })
        ).status,
      ).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('phone-views (xem/gọi SĐT có audit)', () => {
    it('mọi thành viên careTeam xem được số đầy đủ; ghi PHONE_VIEWED KHÔNG chứa số; no-store; người ngoài phạm vi 404 và không có audit', async () => {
      // c3: staffB là PRIMARY, staffA là MEMBER, manager1 trong phạm vi nhóm.
      const stored = (await customers().findOne({
        _id: new Types.ObjectId(ids.c3),
      }))!;
      for (const who of ['staffB', 'staffA', 'manager1', 'admin']) {
        const res = await call(
          'POST',
          `/crm/customers/${ids.c3}/phone-views`,
          who,
          {
            purpose: 'CALL',
          },
        );
        expect(res.status).toBe(201);
        expect(res.body.data.phone).toBe(stored.phone);
        expect(String(res.headers['cache-control'])).toContain('no-store');
      }
      const rows = await auditOf(ids.c3, 'PHONE_VIEWED');
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => row.reason)).toEqual([
        'CALL',
        'CALL',
        'CALL',
        'CALL',
      ]);
      expect(rows.map((row) => row.actorRole)).toEqual([
        'STAFF',
        'STAFF',
        'MANAGER',
        'ADMIN',
      ]);
      const raw = JSON.stringify(rows);
      expect(raw).not.toContain(String(stored.phone).slice(3));
      expect(rows[0].changes).toEqual([]);

      const before = await connection
        .collection('crm_audit_logs')
        .countDocuments({
          action: 'PHONE_VIEWED',
        });
      const outsider = await call(
        'POST',
        `/crm/customers/${ids.c3}/phone-views`,
        'staffC',
        { purpose: 'VIEW' },
      );
      expect(outsider.status).toBe(404);
      expect(
        await connection.collection('crm_audit_logs').countDocuments({
          action: 'PHONE_VIEWED',
        }),
      ).toBe(before);

      const invalid = await call(
        'POST',
        `/crm/customers/${ids.c3}/phone-views`,
        'staffB',
        {
          purpose: 'STEAL',
        },
      );
      expect(invalid.status).toBe(400);
    });

    it('người bị gỡ khỏi nhóm chăm sóc mất quyền ngay (404) ở mọi endpoint, không chờ token hết hạn', async () => {
      const { id } = await createCustomer('staffB');
      expect(
        (
          await call('POST', `/crm/customers/${id}/phone-views`, 'staffB', {
            purpose: 'VIEW',
          })
        ).status,
      ).toBe(201);
      await customers().updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { careTeam: [], primaryAssigneeId: null } },
      );
      for (const url of [
        `/crm/customers/${id}`,
        `/crm/customers/${id}/histories`,
      ]) {
        expect((await call('GET', url, 'staffB')).status).toBe(404);
      }
      expect(
        (
          await call('POST', `/crm/customers/${id}/phone-views`, 'staffB', {
            purpose: 'VIEW',
          })
        ).status,
      ).toBe(404);
    });

    it('tài khoản bị khóa/đổi vai trò: có hiệu lực ngay dù token còn hạn', async () => {
      const token = tokens.blockedStaff;
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm/customers',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Sửa hồ sơ, tình trạng, tiêu chí, đồng ý dữ liệu', () => {
    let id: string;
    let phone: string;
    let version = 0;

    beforeAll(async () => {
      const created = await createCustomer('staffA', {
        fullName: 'Lê Thị Hoa',
      });
      id = created.id;
      phone = created.phone;
    });

    it('PATCH hồ sơ: ghi lastUpdatedAt/By, tăng version, audit giá trị cũ -> mới ĐẦY ĐỦ (kể cả SĐT), searchText cập nhật', async () => {
      const source = (await connection
        .collection('catalog_items')
        .findOne({ code: 'FACEBOOK_ADS' }))!;
      const project = (await connection
        .collection('projects')
        .findOne({ code: 'QTERRA' }))!;
      const newPhone = nextPhone();
      const res = await call('PATCH', `/crm/customers/${id}`, 'staffA', {
        version,
        fullName: 'Lê Thị Hoa Mai',
        phone: newPhone,
        email: 'hoa@example.com',
        sourceId: String(source._id),
        interestedProjectIds: [String(project._id)],
      });
      expect(res.status).toBe(200);
      version = res.body.data.version;
      expect(version).toBe(1);
      expect(res.body.data).toMatchObject({
        fullName: 'Lê Thị Hoa Mai',
        email: 'hoa@example.com',
        source: { id: String(source._id) },
        lastUpdatedBy: { id: ids.staffA },
      });
      expect(res.body.data.projects).toHaveLength(1);

      const [audit] = await auditOf(id, 'CUSTOMER_UPDATED');
      const phoneChange = audit.changes.find((c: any) => c.field === 'phone');
      expect(phoneChange).toEqual({
        field: 'phone',
        from: `+84${phone.slice(1)}`,
        to: `+84${newPhone.slice(1)}`,
      });
      expect(audit.changes.find((c: any) => c.field === 'projects').to).toEqual(
        [project.name],
      );
      phone = newPhone;

      const stored = (await customers()
        .find({ _id: new Types.ObjectId(id) })
        .project({ searchText: 1 })
        .next())!;
      expect(stored.searchText).toContain('le thi hoa mai');
      expect(stored.searchText).toContain(newPhone);
    });

    it('khóa lạc quan: version cũ => 409 VERSION_CONFLICT { currentVersion }; hai PATCH đồng thời cùng version => đúng 1 thành công', async () => {
      const stale = await call('PATCH', `/crm/customers/${id}`, 'staffA', {
        version: 0,
        fullName: 'Cũ',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.errorCode).toBe('VERSION_CONFLICT');
      expect(stale.body.details).toEqual({ currentVersion: version });

      const results = await Promise.all(
        ['A1', 'A2', 'A3'].map((name) =>
          call('PATCH', `/crm/customers/${id}`, 'staffA', {
            version,
            fullName: name,
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      version += 1;
      const detail = await call('GET', `/crm/customers/${id}`, 'staffA');
      expect(detail.body.data.version).toBe(version);
    });

    it('PATCH không đổi gì: không tăng version, không audit; đổi sang SĐT của khách khác => 409', async () => {
      const detail = await call('GET', `/crm/customers/${id}`, 'staffA');
      const before = (await auditOf(id)).length;
      const same = await call('PATCH', `/crm/customers/${id}`, 'staffA', {
        version,
        fullName: detail.body.data.fullName,
      });
      expect(same.status).toBe(200);
      expect(same.body.data.version).toBe(version);
      expect((await auditOf(id)).length).toBe(before);

      const stored = (await customers().findOne({
        _id: new Types.ObjectId(ids.c1),
      }))!;
      const clash = await call('PATCH', `/crm/customers/${id}`, 'staffA', {
        version,
        phone: stored.phone,
      });
      expect(clash.status).toBe(409);
      expect(clash.body.errorCode).toBe('CUSTOMER_PHONE_DUPLICATED');
    });

    it('đổi tình trạng: khách chuyển tab; Hoàn tác; version lệch 409; tình trạng ngừng hoạt động/không tồn tại 400; audit STATUS_CHANGED có lý do', async () => {
      const counts = async (as: string) =>
        (await call('GET', '/crm/customers/list-counts', as)).body.data;
      const before = await counts('staffA');

      const res = await call('PATCH', `/crm/customers/${id}/status`, 'staffA', {
        statusId: status.INTERESTED,
        version,
        reason: 'Khách quan tâm',
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: { listGroup: 'INTERESTED' },
        previousStatusId: status.NOT_CONTACTED,
        version: version + 1,
      });
      version += 1;
      const after = await counts('staffA');
      expect(after.INTERESTED).toBe(before.INTERESTED + 1);
      expect(after.NOT_CONTACTED).toBe(before.NOT_CONTACTED - 1);
      expect(after.ALL).toBe(before.ALL);
      expect(await listIds('staffA', '&listGroup=INTERESTED')).toContain(id);
      expect(await listIds('staffA', '&listGroup=NOT_CONTACTED')).not.toContain(
        id,
      );

      const undo = await call(
        'PATCH',
        `/crm/customers/${id}/status`,
        'staffA',
        {
          statusId: status.NOT_CONTACTED,
          version,
        },
      );
      expect(undo.status).toBe(200);
      version += 1;
      expect(await listIds('staffA', '&listGroup=NOT_CONTACTED')).toContain(id);

      const conflict = await call(
        'PATCH',
        `/crm/customers/${id}/status`,
        'staffA',
        {
          statusId: status.NET,
          version: 0,
        },
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body.errorCode).toBe('VERSION_CONFLICT');

      for (const statusId of [new Types.ObjectId().toHexString()]) {
        const bad = await call(
          'PATCH',
          `/crm/customers/${id}/status`,
          'staffA',
          {
            statusId,
            version,
          },
        );
        expect(bad.status).toBe(400);
      }
      const dropped = (await auditOf(id, 'STATUS_CHANGED'))[0];
      expect(dropped.reason).toBe('Khách quan tâm');
      expect(dropped.changes[0]).toMatchObject({
        field: 'status',
        to: { listGroup: 'INTERESTED' },
      });
    });

    it('tiêu chí: server tính progress = số tiêu chí xong x 25; version lệch 409; gửi lại giá trị cũ là no-op', async () => {
      const res = await call(
        'PATCH',
        `/crm/customers/${id}/criteria`,
        'staffA',
        {
          version,
          demand: { isDone: true, description: 'Căn 2PN' },
          finance: { isDone: true },
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.progress).toBe(50);
      expect(res.body.data.criteria.demand).toMatchObject({
        isDone: true,
        description: 'Căn 2PN',
        updatedBy: { id: ids.staffA },
      });
      version = res.body.data.version;

      const detail = await call('GET', `/crm/customers/${id}`, 'staffA');
      expect(detail.body.data).toMatchObject({
        progress: 50,
        criteriaDone: {
          demand: true,
          motivation: false,
          finance: true,
          timing: false,
        },
      });

      const noop = await call(
        'PATCH',
        `/crm/customers/${id}/criteria`,
        'staffA',
        {
          version,
          demand: { isDone: true },
        },
      );
      expect(noop.body.data.version).toBe(version);

      const all = await call(
        'PATCH',
        `/crm/customers/${id}/criteria`,
        'staffA',
        {
          version,
          motivation: { isDone: true },
          timing: { isDone: true },
        },
      );
      expect(all.body.data.progress).toBe(100);
      version = all.body.data.version;

      const stale = await call(
        'PATCH',
        `/crm/customers/${id}/criteria`,
        'staffA',
        {
          version: 0,
          timing: { isDone: false },
        },
      );
      expect(stale.status).toBe(409);
      expect((await auditOf(id, 'CRITERIA_UPDATED')).length).toBe(2);
      // progress không nhận từ client (field thừa bị từ chối).
      const forged = await call(
        'PATCH',
        `/crm/customers/${id}/criteria`,
        'staffA',
        {
          version,
          progress: 100,
        },
      );
      expect(forged.status).toBe(400);
    });

    it('đồng ý dữ liệu: ghi nhận người/thời điểm + audit DATA_CONSENT_UPDATED; giá trị lạ 400', async () => {
      const res = await call(
        'PUT',
        `/crm/customers/${id}/data-consent`,
        'staffA',
        {
          status: 'GRANTED',
          method: 'VERBAL',
          note: 'Khách đồng ý qua điện thoại',
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'GRANTED',
        method: 'VERBAL',
        recordedBy: { id: ids.staffA },
      });
      expect((await auditOf(id, 'DATA_CONSENT_UPDATED')).length).toBe(1);
      expect(
        (
          await call('PUT', `/crm/customers/${id}/data-consent`, 'staffA', {
            status: 'MAYBE',
          })
        ).status,
      ).toBe(400);
      const detail = await call('GET', `/crm/customers/${id}`, 'staffA');
      expect(detail.body.data.dataConsent.status).toBe('GRANTED');
    });

    it('lưu id cho nhóm sau', () => {
      ids.edited = id;
      expect(id).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('CCCD (mã hóa AES-256-GCM + AAD, xem có audit)', () => {
    const NATIONAL_ID = '012345678901';
    let id: string;

    beforeAll(async () => {
      id = (
        await createCustomer('manager1', {
          careTeam: { memberIds: [ids.staffA], primaryUserId: ids.staffB },
        })
      ).id;
    });

    it('nhập CCCD: lưu dạng mã hóa (không có số rõ trong DB), chỉ 4 số cuối + cờ; response/chi tiết/audit chỉ có dạng che', async () => {
      const res = await call(
        'PUT',
        `/crm/customers/${id}/national-id`,
        'staffA',
        {
          nationalId: NATIONAL_ID,
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        hasNationalId: true,
        nationalIdMasked: '••••8901',
      });

      const raw = (await customers()
        .find({ _id: new Types.ObjectId(id) })
        .project({ nationalId: 1, nationalIdLast4: 1, hasNationalId: 1 })
        .next())!;
      expect(raw.nationalIdLast4).toBe('8901');
      expect(raw.hasNationalId).toBe(true);
      expect(raw.nationalId).toMatchObject({ keyVersion: 1 });
      expect(JSON.stringify(raw)).not.toContain(NATIONAL_ID);
      // Giải mã đúng khi truyền ĐÚNG aad; sai aad (chép sang khách khác) thì thất bại.
      expect(pii.decrypt(raw.nationalId as never, `${id}:nationalId`)).toBe(
        NATIONAL_ID,
      );
      expect(() =>
        pii.decrypt(raw.nationalId as never, `${ids.c1}:nationalId`),
      ).toThrow();
      expect(() => pii.decrypt(raw.nationalId as never)).toThrow();

      const detail = await call('GET', `/crm/customers/${id}`, 'staffA');
      expect(detail.body.data).toMatchObject({
        hasNationalId: true,
        nationalIdMasked: '••••8901',
        canRevealNationalId: false,
      });
      expect(JSON.stringify(detail.body)).not.toContain(NATIONAL_ID);
      const audit = JSON.stringify(await auditOf(id, 'NATIONAL_ID_UPDATED'));
      expect(audit).not.toContain(NATIONAL_ID);
      expect(audit).toContain('••••8901');
      expect(JSON.stringify(await auditOf(id))).not.toContain(NATIONAL_ID);
    });

    it('định dạng sai => 400; lọc theo hasNationalId', async () => {
      for (const nationalId of ['1234', '12345678901a', '1234567890123']) {
        expect(
          (
            await call('PUT', `/crm/customers/${id}/national-id`, 'staffA', {
              nationalId,
            })
          ).status,
        ).toBe(400);
      }
      expect(await listIds('admin', '&hasNationalId=true')).toContain(id);
      expect(await listIds('admin', '&hasNationalId=false')).not.toContain(id);
    });

    it('xem đầy đủ: chỉ Quản trị, Quản lý trong phạm vi hoặc PHỤ TRÁCH CHÍNH; thành viên thường 403 NATIONAL_ID_FORBIDDEN; mỗi lần xem có audit + no-store', async () => {
      for (const who of ['staffB', 'manager1', 'admin']) {
        const res = await call(
          'POST',
          `/crm/customers/${id}/national-id-views`,
          who,
          {
            purpose: 'Làm hợp đồng',
          },
        );
        expect(res.status).toBe(201);
        expect(res.body.data.nationalId).toBe(NATIONAL_ID);
        expect(String(res.headers['cache-control'])).toContain('no-store');
      }
      const member = await call(
        'POST',
        `/crm/customers/${id}/national-id-views`,
        'staffA',
        {},
      );
      expect(member.status).toBe(403);
      expect(member.body.errorCode).toBe('NATIONAL_ID_FORBIDDEN');

      const views = await auditOf(id, 'NATIONAL_ID_VIEWED');
      expect(views).toHaveLength(3);
      expect(JSON.stringify(views)).not.toContain(NATIONAL_ID);

      const log = await call(
        'GET',
        `/crm/customers/${id}/national-id-views`,
        'manager1',
      );
      expect(log.status).toBe(200);
      expect(log.body.meta.total).toBe(3);
      expect(log.body.data[0]).toMatchObject({
        purpose: 'Làm hợp đồng',
        source: 'WEB',
      });
      expect(
        (await call('GET', `/crm/customers/${id}/national-id-views`, 'staffB'))
          .status,
      ).toBe(403);
    });

    it('bản mã bị chép sang khách khác không giải mã được (AAD) => lỗi chung, không lộ dữ liệu', async () => {
      const source = (await customers()
        .find({ _id: new Types.ObjectId(id) })
        .project({ nationalId: 1 })
        .next())!;
      const other = await createCustomer('admin');
      await customers().updateOne(
        { _id: new Types.ObjectId(other.id) },
        {
          $set: {
            nationalId: source.nationalId,
            nationalIdLast4: '8901',
            hasNationalId: true,
          },
        },
      );
      const res = await call(
        'POST',
        `/crm/customers/${other.id}/national-id-views`,
        'admin',
        {},
      );
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain(NATIONAL_ID);
      expect(await auditOf(other.id, 'NATIONAL_ID_VIEWED')).toHaveLength(0);
    });

    it('rate limit xem CCCD 10 lần/phút/người => 429', async () => {
      await createUser('viewer', UserRole.ADMIN);
      const codes: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        codes.push(
          (
            await call(
              'POST',
              `/crm/customers/${id}/national-id-views`,
              'viewer',
              {},
            )
          ).status,
        );
      }
      expect(codes.slice(0, 10).every((code) => code === 201)).toBe(true);
      expect(codes[10]).toBe(429);
    });

    it('xóa CCCD: gỡ bản mã + cờ, audit NATIONAL_ID_REMOVED; xóa lần nữa là no-op 204; khách chưa có CCCD xem => 404', async () => {
      expect(
        (await call('DELETE', `/crm/customers/${id}/national-id`, 'staffA'))
          .status,
      ).toBe(204);
      const raw = (await customers()
        .find({ _id: new Types.ObjectId(id) })
        .project({ nationalId: 1, nationalIdLast4: 1, hasNationalId: 1 })
        .next())!;
      expect(raw).toMatchObject({
        nationalId: null,
        nationalIdLast4: null,
        hasNationalId: false,
      });
      expect(
        (await call('DELETE', `/crm/customers/${id}/national-id`, 'staffA'))
          .status,
      ).toBe(204);
      expect(await auditOf(id, 'NATIONAL_ID_REMOVED')).toHaveLength(1);
      const view = await call(
        'POST',
        `/crm/customers/${id}/national-id-views`,
        'admin',
        {},
      );
      expect(view.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Danh sách 5 tab, tìm kiếm, sắp xếp, phân trang', () => {
    beforeAll(async () => {
      const mk = async (
        fullName: string,
        extra: Record<string, unknown> = {},
      ) => {
        const res = await call('POST', '/crm/customers', 'admin', {
          fullName,
          phone: nextPhone(),
          careTeam: { memberIds: [], primaryUserId: ids.staffD },
          ...extra,
        });
        expect(res.status).toBe(201);
        return res.body.data.id as string;
      };
      ids.sortA = await mk('Đặng Văn Bảo');
      ids.sortB = await mk('Điền Thị Cúc');
      ids.sortC = await mk('Đào Minh Dũng');
      ids.sortD = await mk('Ân Hữu Em');
      // staffD chưa có nhóm: touch cho teamIds [] — không ảnh hưởng.
      await call('PATCH', `/crm/customers/${ids.sortB}/status`, 'admin', {
        statusId: status.NET,
        version: 0,
      });
      await call('PATCH', `/crm/customers/${ids.sortC}/status`, 'admin', {
        statusId: status.DROPPED,
        version: 0,
      });
      await call('PATCH', `/crm/customers/${ids.sortD}/status`, 'admin', {
        statusId: status.INTERESTED,
        version: 0,
      });
    });

    it('list-counts: 5 tab đúng theo tình trạng, tab ALL = tổng, byStatus; áp dụng phạm vi (staffD chỉ thấy 4 khách của mình)', async () => {
      const res = await call('GET', '/crm/customers/list-counts', 'staffD');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        ALL: 4,
        NOT_CONTACTED: 1,
        INTERESTED: 1,
        NET: 1,
        DROPPED: 1,
      });
      expect(res.body.data.byStatus).toHaveLength(4);

      const admin = await call('GET', '/crm/customers/list-counts', 'admin');
      const { ALL, NOT_CONTACTED, INTERESTED, NET, DROPPED } = admin.body.data;
      expect(ALL).toBe(NOT_CONTACTED + INTERESTED + NET + DROPPED);
      expect(await customers().countDocuments({ deletedAt: null })).toBe(ALL);
    });

    it('mỗi tab chỉ trả khách của tab đó; mặc định (không listGroup) = ALL; meta phân trang chuẩn', async () => {
      const group = async (listGroup: string) =>
        (await call('GET', `/crm/customers?listGroup=${listGroup}`, 'staffD'))
          .body;
      for (const [tab, expected] of [
        ['NOT_CONTACTED', ids.sortA],
        ['NET', ids.sortB],
        ['DROPPED', ids.sortC],
        ['INTERESTED', ids.sortD],
      ]) {
        const body = await group(tab);
        expect(body.data.map((item: any) => item.id)).toEqual([expected]);
        expect(body.data[0].status.listGroup).toBe(tab);
      }
      const all = await call('GET', '/crm/customers?limit=3&page=2', 'staffD');
      expect(all.body.meta).toEqual({
        total: 4,
        page: 2,
        limit: 3,
        totalPages: 2,
      });
      expect(all.body.data).toHaveLength(1);
      expect(
        (await call('GET', '/crm/customers?listGroup=CARING', 'staffD')).status,
      ).toBe(400);
      expect(
        (await call('GET', '/crm/customers?limit=101', 'staffD')).status,
      ).toBe(400);
    });

    it('sort theo tên dùng collation tiếng Việt (Ân < Đào < Đặng < Điền); sort ngoài whitelist 400; sort mặc định -lastUpdatedAt', async () => {
      const asc = await call('GET', '/crm/customers?sort=fullName', 'staffD');
      expect(asc.body.data.map((item: any) => item.fullName)).toEqual([
        'Ân Hữu Em',
        'Đào Minh Dũng',
        'Đặng Văn Bảo',
        'Điền Thị Cúc',
      ]);
      const desc = await call('GET', '/crm/customers?sort=-fullName', 'staffD');
      expect(desc.body.data[0].fullName).toBe('Điền Thị Cúc');
      const bad = await call('GET', '/crm/customers?sort=phone', 'staffD');
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe('INVALID_SORT_FIELD');
      const byUpdated = (await call('GET', '/crm/customers', 'staffD')).body
        .data;
      const times = byUpdated.map((item: any) => item.lastUpdatedAt);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it('tìm theo tên không dấu/hoa thường, theo email; list không bao giờ chứa SĐT đầy đủ hay searchText/CCCD', async () => {
      const byName = await call(
        'GET',
        `/crm/customers?q=${encodeURIComponent('dang van')}`,
        'staffD',
      );
      expect(byName.body.data.map((item: any) => item.id)).toEqual([ids.sortA]);
      const byAccent = await call(
        'GET',
        `/crm/customers?q=${encodeURIComponent('ĐIỀN')}`,
        'staffD',
      );
      expect(byAccent.body.data.map((item: any) => item.id)).toEqual([
        ids.sortB,
      ]);

      const emailed = await createCustomer('admin', {
        email: 'Tim.Kiem@Mail.vn',
        careTeam: { memberIds: [], primaryUserId: ids.staffD },
      });
      const byEmail = await call(
        'GET',
        '/crm/customers?q=tim.kiem@mail',
        'staffD',
      );
      expect(byEmail.body.data.map((item: any) => item.id)).toEqual([
        emailed.id,
      ]);

      const everything = JSON.stringify(
        (await call('GET', '/crm/customers?limit=100', 'admin')).body,
      );
      expect(everything).not.toMatch(/\+84\d{9}/);
      expect(everything).not.toContain('searchText');
      expect(everything).not.toContain('cipherText');
      expect(everything).not.toContain('"phone"');
    });

    it('chống dò SĐT qua tìm kiếm: <4 số không có kết quả; 4-5 số chỉ khớp ĐUÔI; từ 6 số khớp chuỗi con', async () => {
      const target = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffD },
      });
      const national = target.phone; // 091XXXXXXX
      const find = async (q: string) =>
        (
          await call(
            'GET',
            `/crm/customers?q=${encodeURIComponent(q)}`,
            'staffD',
          )
        ).body.data.map((item: any) => item.id);

      expect(await find(national.slice(0, 3))).toEqual([]);
      expect(await find(national.slice(3, 6))).toEqual([]);
      expect(await find(national.slice(-3))).toEqual([]);
      expect(await find(national.slice(-4))).toContain(target.id);
      expect(await find(national.slice(-5))).toContain(target.id);
      // 4 số GIỮA số điện thoại không khớp (chỉ khớp đuôi).
      expect(await find(national.slice(3, 7))).toEqual([]);
      expect(await find(national.slice(2, 8))).toContain(target.id);
      expect(await find(`+84${national.slice(1)}`)).toContain(target.id);
      expect(
        await find(national.slice(0, 3) + ' ' + national.slice(3)),
      ).toContain(target.id);
    });

    it('rate limit tìm kiếm 30 lần/phút/người => 429; list-counts cũng tính', async () => {
      await createUser('searcher', UserRole.ADMIN);
      const codes: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        // Mỗi lần một từ khóa KHÁC nhau (cùng từ khóa trong vài giây chỉ tốn 1 lượt, xem test bên dưới).
        codes.push(
          (await call('GET', `/crm/customers?q=nguyen${i}`, 'searcher')).status,
        );
      }
      expect(codes.slice(0, 30).every((code) => code === 200)).toBe(true);
      expect(codes[30]).toBe(429);
      // list-counts của CÙNG từ khóa vừa tìm (giao diện gọi list + list-counts cùng lúc) không tốn thêm lượt.
      expect(
        (await call('GET', '/crm/customers/list-counts?q=nguyen29', 'searcher'))
          .status,
      ).toBe(200);
      expect(
        (await call('GET', '/crm/customers?q=nguyen29&page=2', 'searcher'))
          .status,
      ).toBe(200);
      // Từ khóa khác thì vẫn bị đếm: hết lượt => 429.
      expect(
        (await call('GET', '/crm/customers/list-counts?q=nguyen99', 'searcher'))
          .status,
      ).toBe(429);
      expect((await call('GET', '/crm/customers', 'searcher')).status).toBe(
        200,
      );
    });

    it('dò số dồn dập (>= 20 số khác nhau/giờ) sinh cảnh báo PHONE_SEARCH_ANOMALY đúng 1 lần cho Quản trị', async () => {
      await createUser('scanner', UserRole.ADMIN);
      for (let i = 0; i < 22; i += 1) {
        await call(
          'GET',
          `/crm/customers?q=${String(100000 + i)}&limit=1`,
          'scanner',
        );
      }
      const alerts = await connection
        .collection('crm_audit_logs')
        .find({ action: 'PHONE_SEARCH_ANOMALY' })
        .toArray();
      expect(alerts).toHaveLength(1);
      expect(String(alerts[0].actorId)).toBe(ids.scanner);
      expect(JSON.stringify(alerts)).not.toContain('100000');
      const audit = await call(
        'GET',
        '/crm/audit-logs?action=PHONE_SEARCH_ANOMALY',
        'admin',
      );
      expect(audit.body.data).toHaveLength(1);
    });

    it('lọc: assigneeIds, primaryAssigneeIds, progress, khoảng ngày, teamIds, areaIds (gồm con); ngày sai định dạng 400', async () => {
      const byAssignee = await listIds('admin', `&assigneeIds=${ids.staffD}`);
      expect(byAssignee).toEqual(
        expect.arrayContaining([ids.sortA, ids.sortB]),
      );
      expect(byAssignee).not.toContain(ids.c1);
      expect(
        await listIds('admin', `&primaryAssigneeIds=${ids.staffC}`),
      ).toEqual([ids.c2]);
      expect(await listIds('admin', `&teamIds=${ids.teamB}`)).toContain(ids.c2);
      expect(await listIds('admin', '&progress=100')).toContain(ids.edited);
      expect(
        await listIds('admin', '&progressMin=75&progressMax=100'),
      ).toContain(ids.edited);
      expect(await listIds('admin', '&progress=0,25')).not.toContain(
        ids.edited,
      );
      expect(await listIds('admin', '&updatedFrom=2999-01-01')).toEqual([]);
      expect(
        await listIds('admin', '&updatedFrom=2000-01-01&updatedTo=2999-01-01'),
      ).toContain(ids.c1);
      expect(
        (await call('GET', '/crm/customers?updatedFrom=01/10/2026', 'admin'))
          .status,
      ).toBe(400);
      expect(
        (await call('GET', '/crm/customers?statusIds=abc', 'admin')).status,
      ).toBe(400);

      const province = (await connection
        .collection('areas')
        .findOne({ parentId: null }))!;
      const child = await connection
        .collection('areas')
        .findOne({ ancestorIds: province._id });
      if (child) {
        const cust = await createCustomer('admin', {
          areaId: String(child._id),
        });
        expect(
          await listIds('admin', `&areaIds=${String(province._id)}`),
        ).toContain(cust.id);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Vòng đời: xóa mềm, khôi phục, ẩn danh hóa', () => {
    let id: string;
    let phone: string;

    beforeAll(async () => {
      const created = await createCustomer('staffA', {
        fullName: 'Phạm Quốc Hưng',
        email: 'hung@example.com',
      });
      id = created.id;
      phone = created.phone;
      await call('PATCH', `/crm/customers/${id}`, 'staffA', {
        version: 0,
        fullName: 'Phạm Quốc Hưng Mới',
      });
      await call('PATCH', `/crm/customers/${id}/criteria`, 'staffA', {
        version: 1,
        demand: { isDone: true, description: 'Cần gặp anh Hưng gấp' },
      });
      await call('PUT', `/crm/customers/${id}/national-id`, 'staffA', {
        nationalId: '098765432101',
      });
    });

    it('xóa mềm: Nhân viên 403; Quản lý trong phạm vi/Quản trị 204 bắt buộc reason; khách biến khỏi list/chi tiết; SĐT vẫn bị giữ (không tạo lại)', async () => {
      expect(
        (await call('DELETE', `/crm/customers/${id}?reason=x`, 'staffA'))
          .status,
      ).toBe(403);
      expect(
        (await call('DELETE', `/crm/customers/${id}`, 'manager1')).status,
      ).toBe(400);
      expect(
        (await call('DELETE', `/crm/customers/${id}?reason=x`, 'manager2'))
          .status,
      ).toBe(404);
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${id}?reason=${encodeURIComponent('Nhập nhầm')}`,
            'manager1',
          )
        ).status,
      ).toBe(204);

      expect(await listIds('staffA')).not.toContain(id);
      expect(await listIds('admin')).not.toContain(id);
      expect((await call('GET', `/crm/customers/${id}`, 'admin')).status).toBe(
        404,
      );
      const [audit] = await auditOf(id, 'CUSTOMER_DELETED');
      expect(audit).toMatchObject({
        reason: 'Nhập nhầm',
        actorRole: 'MANAGER',
      });

      const recreate = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'Lại',
        phone,
      });
      expect(recreate.status).toBe(409);
      // Người không phải Quản trị chỉ biết "đã tồn tại", không lộ người phụ trách của khách đã xóa.
      expect(recreate.body.details).toMatchObject({
        exists: true,
        isAccessible: false,
      });
      expect(recreate.body.details.caredByName).toBeUndefined();
      expect(recreate.body.details.customerRef).toBeUndefined();
      const adminLookup = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'admin',
        { phone },
      );
      expect(adminLookup.body.data).toMatchObject({
        isAccessible: true,
        isDeleted: true,
        customerId: id,
      });
    });

    it('GET /crm/deleted-customers: chỉ Quản trị; có deletedAt/deletedBy; lọc q', async () => {
      for (const who of ['manager1', 'staffA']) {
        expect((await call('GET', '/crm/deleted-customers', who)).status).toBe(
          403,
        );
      }
      const res = await call('GET', '/crm/deleted-customers', 'admin');
      expect(res.status).toBe(200);
      const row = res.body.data.find((item: any) => item.id === id);
      expect(row).toMatchObject({
        deletedBy: { id: ids.manager1 },
        anonymizedAt: null,
      });
      expect(JSON.stringify(res.body)).not.toContain(phone);
      const filtered = await call(
        'GET',
        `/crm/deleted-customers?q=${encodeURIComponent('pham quoc')}`,
        'admin',
      );
      expect(filtered.body.data.map((item: any) => item.id)).toEqual([id]);
    });

    it('khôi phục: chỉ Quản trị; khách quay lại danh sách với dữ liệu nguyên vẹn; khôi phục khách chưa xóa 404', async () => {
      for (const who of ['manager1', 'staffA']) {
        expect(
          (
            await call('POST', '/crm/customer-restorations', who, {
              customerId: id,
            })
          ).status,
        ).toBe(403);
      }
      const res = await call('POST', '/crm/customer-restorations', 'admin', {
        customerId: id,
        reason: 'Nhầm lẫn',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        id,
        fullName: 'Phạm Quốc Hưng Mới',
      });
      expect(await listIds('staffA')).toContain(id);
      expect(await auditOf(id, 'CUSTOMER_RESTORED')).toHaveLength(1);
      expect(
        (
          await call('POST', '/crm/customer-restorations', 'admin', {
            customerId: id,
          })
        ).status,
      ).toBe(404);
    });

    it('ẩn danh hóa: chỉ Quản trị, cần confirm=true; ghi đè PII (tên, SĐT, email, CCCD, mô tả tiêu chí) và PII trong audit của chính khách đó; giữ khung thống kê; không hoàn tác; số cũ dùng lại được', async () => {
      const body = { customerId: id, reason: 'Khách yêu cầu xóa dữ liệu' };
      expect(
        (
          await call('POST', '/crm/customer-anonymizations', 'manager1', {
            ...body,
            confirm: true,
          })
        ).status,
      ).toBe(403);
      expect(
        (await call('POST', '/crm/customer-anonymizations', 'admin', body))
          .status,
      ).toBe(400);
      expect(
        (
          await call('POST', '/crm/customer-anonymizations', 'admin', {
            ...body,
            confirm: false,
          })
        ).status,
      ).toBe(400);

      const res = await call('POST', '/crm/customer-anonymizations', 'admin', {
        ...body,
        confirm: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.customerId).toBe(id);

      const raw = (await customers()
        .find({ _id: new Types.ObjectId(id) })
        .project({
          searchText: 1,
          nationalId: 1,
          fullName: 1,
          phone: 1,
          email: 1,
          criteria: 1,
          deletedAt: 1,
          anonymizedAt: 1,
          statusId: 1,
          careTeam: 1,
          progress: 1,
          hasNationalId: 1,
        })
        .next())!;
      expect(raw).toMatchObject({
        fullName: 'Khách đã ẩn danh',
        email: null,
        nationalId: null,
        hasNationalId: false,
        searchText: '',
        progress: 25,
      });
      expect(raw.phone).toBe(`anonymized:${id}`);
      expect(raw.deletedAt).toBeInstanceOf(Date);
      expect(raw.anonymizedAt).toBeInstanceOf(Date);
      expect(raw.criteria.demand.description).toBe('');
      expect(raw.careTeam).toHaveLength(1);
      expect(raw.statusId).toBeDefined();

      const auditJson = JSON.stringify(await auditOf(id));
      for (const secret of [
        phone.slice(3),
        'Phạm Quốc Hưng',
        'hung@example.com',
        '098765432101',
        'Nhập nhầm',
        // Văn bản tự do của tiêu chí (CRITERIA_UPDATED) cũng phải bị ghi đè trong audit.
        'Cần gặp anh Hưng gấp',
      ]) {
        expect(auditJson).not.toContain(secret);
      }
      expect(await auditOf(id, 'CUSTOMER_ANONYMIZED')).toHaveLength(1);

      expect(
        (
          await call('POST', '/crm/customer-anonymizations', 'admin', {
            ...body,
            confirm: true,
          })
        ).body.errorCode,
      ).toBe('CUSTOMER_ANONYMIZED');
      const restore = await call(
        'POST',
        '/crm/customer-restorations',
        'admin',
        { customerId: id },
      );
      expect(restore.status).toBe(409);
      expect(restore.body.errorCode).toBe('CUSTOMER_ANONYMIZED');
      expect(await listIds('admin')).not.toContain(id);
      const deleted = await call('GET', '/crm/deleted-customers', 'admin');
      const row = deleted.body.data.find((item: any) => item.id === id);
      expect(row.phoneMasked).toBe('••••');
      expect(JSON.stringify(deleted.body)).not.toContain('Phạm Quốc');

      const reuse = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'Người mới',
        phone,
      });
      expect(reuse.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Lịch sử (histories) và audit', () => {
    it('histories: ai/lúc nào/đổi gì; SĐT cũ -> mới đầy đủ; PHONE_VIEWED/NATIONAL_ID_VIEWED chỉ Quản trị/Quản lý; PHONE_LOOKUP không hiện', async () => {
      const id = ids.c3;
      await call('POST', `/crm/customers/${id}/national-id-views`, 'admin', {});
      const stored = (await customers().findOne({
        _id: new Types.ObjectId(id),
      }))!;
      const newPhone = nextPhone();
      await call('PATCH', `/crm/customers/${id}`, 'staffA', {
        version: stored.__v,
        phone: newPhone,
      });

      const asStaff = await call(
        'GET',
        `/crm/customers/${id}/histories?limit=100`,
        'staffA',
      );
      expect(asStaff.status).toBe(200);
      const staffActions = asStaff.body.data.map((row: any) => row.action);
      expect(staffActions).toContain('CUSTOMER_UPDATED');
      expect(staffActions).toContain('CUSTOMER_CREATED');
      expect(staffActions).not.toContain('PHONE_VIEWED');
      expect(staffActions).not.toContain('NATIONAL_ID_VIEWED');
      expect(staffActions).not.toContain('PHONE_LOOKUP');
      const update = asStaff.body.data.find(
        (row: any) => row.action === 'CUSTOMER_UPDATED',
      );
      expect(update).toMatchObject({
        actor: { id: ids.staffA },
        actorRole: 'STAFF',
        source: 'WEB',
      });
      expect(update.changes).toEqual([
        { field: 'phone', from: stored.phone, to: `+84${newPhone.slice(1)}` },
      ]);

      const asManager = await call(
        'GET',
        `/crm/customers/${id}/histories?actions=PHONE_VIEWED&limit=100`,
        'manager1',
      );
      expect(asManager.body.data.length).toBeGreaterThan(0);
      expect(
        asManager.body.data.every((row: any) => row.action === 'PHONE_VIEWED'),
      ).toBe(true);
      expect(JSON.stringify(asManager.body)).not.toContain(stored.phone);
      // Nhân viên lọc đúng action bị hạn chế: không có gì.
      const hidden = await call(
        'GET',
        `/crm/customers/${id}/histories?actions=PHONE_VIEWED`,
        'staffA',
      );
      expect(hidden.body.data).toEqual([]);
      expect(hidden.body.meta.total).toBe(0);

      const created = asStaff.body.data.find(
        (row: any) => row.action === 'CUSTOMER_CREATED',
      );
      const phoneChange = created.changes.find((c: any) => c.field === 'phone');
      expect(phoneChange.to).toMatch(/•••/);
    });

    it('GET /crm/audit-logs chỉ Quản trị, lọc theo customerId/action/actorId, có requestId', async () => {
      for (const who of ['manager1', 'staffA']) {
        expect((await call('GET', '/crm/audit-logs', who)).status).toBe(403);
      }
      expect(
        (await call('GET', '/crm/audit-logs?entityType=KHONG_CO', 'admin'))
          .status,
      ).toBe(400);
      expect(
        (await call('GET', '/crm/audit-logs?entityType=CUSTOMER', 'admin'))
          .status,
      ).toBe(200);
      const res = await call(
        'GET',
        `/crm/audit-logs?customerId=${ids.c3}&action=PHONE_VIEWED`,
        'admin',
      );
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(4);
      expect(res.body.data[0]).toMatchObject({
        entityType: 'CUSTOMER',
        customerId: ids.c3,
        action: 'PHONE_VIEWED',
      });
      expect(res.body.data[0].requestId).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Đồng bộ customers.teamIds khi đổi nhóm/vai trò (việc M1 để lại cho M2)', () => {
    it('PATCH /users/:id/team: teamIds của khách của người đó được tính lại cùng transaction; Quản lý nhóm cũ mất quyền, nhóm mới có quyền', async () => {
      const mine = await createCustomer('staffA');
      expect(await listIds('manager1')).toContain(mine.id);
      expect(await listIds('manager2')).not.toContain(mine.id);

      const moved = await call('PATCH', `/users/${ids.staffA}/team`, 'admin', {
        teamId: ids.teamB,
      });
      expect(moved.status).toBe(200);
      expect(
        (
          await customers().findOne({ _id: new Types.ObjectId(mine.id) })
        )?.teamIds.map(String),
      ).toEqual([ids.teamB]);
      expect(await listIds('manager1')).not.toContain(mine.id);
      expect(await listIds('manager2')).toContain(mine.id);
      // Khách có nhiều thành viên: teamIds = hợp nhóm của họ (c3 có staffB nhóm A + staffA nhóm B).
      expect(
        (
          await customers().findOne({ _id: new Types.ObjectId(ids.c3) })
        )?.teamIds
          .map(String)
          .sort(),
      ).toEqual([ids.teamA, ids.teamB].sort());

      const cleared = await call(
        'PATCH',
        `/users/${ids.staffA}/team`,
        'admin',
        { teamId: null },
      );
      expect(cleared.status).toBe(200);
      expect(
        (await customers().findOne({ _id: new Types.ObjectId(mine.id) }))
          ?.teamIds,
      ).toEqual([]);
      expect(await listIds('manager2')).not.toContain(mine.id);
      // Chính người đó vẫn thấy khách của mình (phạm vi Nhân viên theo careTeam, không theo nhóm).
      expect(await listIds('staffA')).toContain(mine.id);

      await call('PATCH', `/users/${ids.staffA}/team`, 'admin', {
        teamId: ids.teamA,
      });
      expect(
        (
          await customers().findOne({ _id: new Types.ObjectId(mine.id) })
        )?.teamIds.map(String),
      ).toEqual([ids.teamA]);
    });

    it('đổi vai trò làm mất nhóm (STAFF -> ADMIN) cũng đồng bộ teamIds', async () => {
      await createUser('tempStaff', UserRole.STAFF);
      await call('PATCH', `/users/${ids.tempStaff}/team`, 'admin', {
        teamId: ids.teamA,
      });
      const mine = await createCustomer('tempStaff');
      expect(
        (
          await customers().findOne({ _id: new Types.ObjectId(mine.id) })
        )?.teamIds.map(String),
      ).toEqual([ids.teamA]);
      const res = await call('PATCH', `/users/${ids.tempStaff}/role`, 'admin', {
        role: 'ADMIN',
      });
      expect(res.status).toBe(200);
      expect(
        (await customers().findOne({ _id: new Types.ObjectId(mine.id) }))
          ?.teamIds,
      ).toEqual([]);
    });

    it('race: gán nhóm cho người chăm sóc đồng thời với việc tạo khách giao cho họ => teamIds luôn khớp nhóm hiện tại (không write-skew)', async () => {
      await createUser('racer', UserRole.STAFF);
      for (let round = 0; round < 12; round += 1) {
        const team = round % 2 === 0 ? ids.teamA : ids.teamB;
        const [created] = await Promise.all([
          call('POST', '/crm/customers', 'admin', {
            fullName: `Race ${round}`,
            phone: nextPhone(),
            careTeam: { memberIds: [], primaryUserId: ids.racer },
          }),
          call('PATCH', `/users/${ids.racer}/team`, 'admin', { teamId: team }),
        ]);
        // Tạo có thể bị USER_NOT_ASSIGNABLE khi Quản trị chưa có quản lý... Quản trị tạo được cho mọi người: phải 201.
        expect(created.status).toBe(201);
      }
      const racerTeam = (await userModel.findById(ids.racer).lean())!.teamId;
      const stale = await customers()
        .find({ 'careTeam.userId': new Types.ObjectId(ids.racer) })
        .toArray();
      expect(stale).toHaveLength(12);
      for (const doc of stale) {
        expect(doc.teamIds.map(String)).toEqual([String(racerTeam)]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Khóa ghi tham chiếu danh mục (không để khách trỏ vào danh mục đã xóa)', () => {
    it('tạo khách đồng thời với xóa tình trạng: không bao giờ xảy ra "khách dùng tình trạng đã xóa"', async () => {
      for (let round = 0; round < 15; round += 1) {
        const created = await call('POST', '/crm/customer-statuses', 'admin', {
          code: `TMP${round}_${RUN_ID.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`.slice(
            0,
            30,
          ),
          label: `Tạm ${round}`,
          listGroup: 'INTERESTED',
        });
        expect(created.status).toBe(201);
        const statusId = created.body.data.id as string;
        const [customer, removal] = await Promise.all([
          call('POST', '/crm/customers', 'admin', {
            fullName: `Khóa ${round}`,
            phone: nextPhone(),
            statusId,
            careTeam: { memberIds: [], primaryUserId: ids.staffD },
          }),
          call('DELETE', `/crm/customer-statuses/${statusId}`, 'admin'),
        ]);
        const deleted = !!(await connection
          .collection('customer_statuses')
          .findOne({
            _id: new Types.ObjectId(statusId),
            deletedAt: { $ne: null },
          }));
        const used = await customers().countDocuments({
          statusId: new Types.ObjectId(statusId),
        });
        // Bất biến: tình trạng đã xóa thì không có khách dùng.
        expect(deleted && used > 0).toBe(false);
        // Mỗi kết quả hợp lệ: tạo thành công (và xóa bị chặn 409) hoặc tạo bị từ chối (400) và xóa 204.
        expect([customer.status, removal.status]).toEqual(
          customer.status === 201 ? [201, 409] : [400, 204],
        );
      }
    });

    it('khách giữ liên kết với dự án đã ngừng hoạt động; gán MỚI dự án ngừng hoạt động bị từ chối', async () => {
      const project = await call('POST', '/crm/projects', 'admin', {
        name: 'Dự án tạm',
        code: `TMP${RUN_ID}`,
      });
      const projectId = project.body.data.id as string;
      const cust = await createCustomer('admin', {
        interestedProjectIds: [projectId],
        careTeam: { memberIds: [], primaryUserId: ids.staffD },
      });
      expect(
        (await call('DELETE', `/crm/projects/${projectId}`, 'admin')).body
          .errorCode,
      ).toBe('PROJECT_IN_USE');
      expect(
        (
          await call('PATCH', `/crm/projects/${projectId}`, 'admin', {
            isActive: false,
          })
        ).status,
      ).toBe(200);

      // Sửa tên khách vẫn giữ nguyên liên kết dự án đã ngừng.
      const detail = await call('GET', `/crm/customers/${cust.id}`, 'admin');
      const keep = await call('PATCH', `/crm/customers/${cust.id}`, 'admin', {
        version: detail.body.data.version,
        fullName: 'Vẫn giữ dự án',
        interestedProjectIds: [projectId],
      });
      expect(keep.status).toBe(200);
      expect(keep.body.data.projects).toHaveLength(1);

      const other = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffD },
      });
      const assign = await call(
        'PATCH',
        `/crm/customers/${other.id}`,
        'admin',
        {
          version: 0,
          interestedProjectIds: [projectId],
        },
      );
      expect(assign.status).toBe(400);
      expect(assign.body.errorCode).toBe('VALIDATION_FAILED');
    });
  });
});
