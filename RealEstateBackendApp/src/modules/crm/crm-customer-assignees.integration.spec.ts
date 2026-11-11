/**
 * INTEGRATION — `GET /crm/customer-assignees` (T-16, FR-09/FR-18, Architecture mục 5.5a). HTTP thật (Fastify + guard toàn
 * cục + MongoDB Replica Set in-memory). Kiểm điều unit test mock không chứng minh được: nối dây module (DI), phạm vi khách
 * theo vai trò thật (`buildCustomerScope` + `distinct('careTeam.userId')` trên Mongo thật), khách/user xóa mềm bị loại,
 * người BLOCKED có mặt kèm `isLocked`, lọc `q`/`teamId`, phân trang, hình dạng response không lộ trường nhạy cảm, không
 * rate-limit riêng, Swagger có route mới và route cũ đã bị xóa (404).
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

describe('customer-assignees — HTTP + MongoDB Replica Set', () => {
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
    roles: UserRole[],
    extra: Record<string, unknown> = {},
  ) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      roles,
      status: UserStatus.ACTIVE,
      ...extra,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({
      sub: ids[key],
      email: `${key}@test.vn`,
      role: roles[0],
      roles,
    });
  };

  let phoneSeq = 0;
  /** Khách do `as` tạo (người tạo là PRIMARY, T-07). */
  const createCustomer = async (as: string): Promise<string> => {
    const phone = `091${String(5_000_000 + ++phoneSeq)}`;
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const invite = async (customerId: string, as: string, userKey: string) => {
    const res = await call(
      'POST',
      `/crm/customers/${customerId}/care-team/members`,
      as,
      { userIds: [ids[userKey]] },
    );
    expect(res.status).toBe(201);
  };

  const assignees = (as: string, qs = '') =>
    call('GET', `/crm/customer-assignees${qs}`, as);
  const names = (res: Res): string[] =>
    res.body.data.map((u: { displayName: string }) => u.displayName);

  const rateLimitProto = CrmRateLimitService.prototype as {
    consume: CrmRateLimitService['consume'];
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-assignees-${RUN_ID}:`;
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
        teams.insertOne({ name, code: `ASG${index}`, deletedAt: null }),
      ),
    );
    ids.teamA = String(teamA.insertedId);
    ids.teamB = String(teamB.insertedId);

    await createUser('admin', [UserRole.ADMIN]);
    await createUser('editor', [UserRole.EDITOR]);
    await createUser('mgrA', [UserRole.MANAGER], {
      teamIds: [teamA.insertedId],
    });
    await createUser('mgrB', [UserRole.MANAGER], {
      teamIds: [teamB.insertedId],
    });
    await teams.updateOne(
      { _id: teamA.insertedId },
      { $set: { managerIds: [new Types.ObjectId(ids.mgrA)] } },
    );
    await teams.updateOne(
      { _id: teamB.insertedId },
      { $set: { managerIds: [new Types.ObjectId(ids.mgrB)] } },
    );
    await createUser('staffA1', [UserRole.STAFF], {
      teamIds: [teamA.insertedId],
    });
    await createUser('staffA2', [UserRole.STAFF], {
      teamIds: [teamA.insertedId],
    });
    await createUser('staffB1', [UserRole.STAFF], {
      teamIds: [teamB.insertedId],
    });
    await createUser('staffBlocked', [UserRole.STAFF], {
      teamIds: [teamB.insertedId],
    });
    await createUser('staffGone', [UserRole.STAFF], {
      teamIds: [teamB.insertedId],
    });
    await createUser('staffDelCust', [UserRole.STAFF], {
      teamIds: [teamB.insertedId],
    });
    await createUser('staffNoCustomer', [UserRole.STAFF], {
      teamIds: [teamA.insertedId],
    });
    await createUser('adminStaff', [UserRole.ADMIN, UserRole.STAFF]);

    // Dựng dữ liệu (Redis không có ở máy dev: stub rate-limit trong lúc dựng).
    jest.spyOn(rateLimitProto, 'consume').mockResolvedValue(undefined);
    const c1 = await createCustomer('staffA1');
    await invite(c1, 'staffA1', 'staffA2');
    ids.c2 = await createCustomer('staffB1');
    await invite(ids.c2, 'staffB1', 'staffBlocked');
    await createCustomer('staffGone');
    const c4 = await createCustomer('staffDelCust');
    await createCustomer('adminStaff');
    jest.restoreAllMocks();

    // Sau khi gắn vào nhóm chăm sóc: khóa tài khoản, xóa mềm user, xóa mềm khách.
    await userModel.updateOne(
      { _id: ids.staffBlocked },
      { $set: { status: UserStatus.BLOCKED } },
    );
    await userModel.updateOne(
      { _id: ids.staffGone },
      { $set: { deletedAt: new Date() } },
    );
    await connection
      .collection('customers')
      .updateOne(
        { _id: new Types.ObjectId(c4) },
        { $set: { deletedAt: new Date() } },
      );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  describe('Phạm vi theo vai trò', () => {
    it('Admin: mọi người trong careTeam của khách còn sống; loại user xóa mềm, người của khách xóa mềm, người chưa vào nhóm nào; gồm BLOCKED', async () => {
      const res = await assignees('admin');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual([
        'adminStaff',
        'staffA1',
        'staffA2',
        'staffB1',
        'staffBlocked',
      ]);
      expect(res.body.meta).toEqual({
        total: 5,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('Manager: chỉ người trong khách của nhóm mình quản lý (hoặc khách có mình trong careTeam)', async () => {
      expect(names(await assignees('mgrA'))).toEqual(['staffA1', 'staffA2']);
      expect(names(await assignees('mgrB'))).toEqual([
        'staffB1',
        'staffBlocked',
      ]);
    });

    it('Staff: chỉ người cùng nhóm chăm sóc với khách của mình', async () => {
      expect(names(await assignees('staffA1'))).toEqual(['staffA1', 'staffA2']);
      expect(names(await assignees('staffA2'))).toEqual(['staffA1', 'staffA2']);
      expect(names(await assignees('staffB1'))).toEqual([
        'staffB1',
        'staffBlocked',
      ]);
      // Chưa có khách nào: danh sách rỗng.
      const none = await assignees('staffNoCustomer');
      expect(none.status).toBe(200);
      expect(none.body.data).toEqual([]);
      expect(none.body.meta.total).toBe(0);
    });

    it('Manager được mời vào khách nhóm khác thì thấy người trong khách đó (mgrA vào khách của staffB1)', async () => {
      jest.spyOn(rateLimitProto, 'consume').mockResolvedValue(undefined);
      try {
        await invite(ids.c2, 'admin', 'mgrA');
      } finally {
        jest.restoreAllMocks();
      }
      expect(names(await assignees('mgrA'))).toEqual([
        'mgrA',
        'staffA1',
        'staffA2',
        'staffB1',
        'staffBlocked',
      ]);
      // mgrB không đổi; mgrA có role MANAGER.
      const res = await assignees('mgrA', '?q=mgrA');
      expect(res.body.data[0]).toMatchObject({ role: 'MANAGER' });
    });

    it('Editor (không thuộc CRM_ROLES) ⇒ 403; không token ⇒ 401', async () => {
      expect((await assignees('editor')).status).toBe(403);
      const anonymous = await app.inject({
        method: 'GET',
        url: '/api/v1/crm/customer-assignees',
      });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('Response', () => {
    it('chỉ có id, displayName, role, team, teams, isLocked; BLOCKED ⇒ isLocked true; không email/SĐT/CCCD/id nhóm thừa', async () => {
      const res = await assignees('admin', '?limit=100');
      for (const item of res.body.data as object[]) {
        expect(Object.keys(item).sort()).toEqual([
          'displayName',
          'id',
          'isLocked',
          'role',
          'team',
          'teams',
        ]);
      }
      const byName = new Map<string, unknown>(
        (res.body.data as Array<{ displayName: string }>).map((u) => [
          u.displayName,
          u,
        ]),
      );
      expect(byName.get('staffBlocked')).toMatchObject({
        id: ids.staffBlocked,
        isLocked: true,
        role: 'STAFF',
      });
      expect(byName.get('staffA1')).toMatchObject({
        isLocked: false,
        role: 'STAFF',
        team: { id: ids.teamA, label: 'Nhóm A' },
        teams: [{ id: ids.teamA, label: 'Nhóm A' }],
      });
      // Người chưa thuộc nhóm nào: team null, teams rỗng; ADMIN+STAFF ⇒ role STAFF (role phân chăm sóc cao nhất).
      expect(byName.get('adminStaff')).toMatchObject({
        role: 'STAFF',
        team: null,
        teams: [],
      });
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('@test.vn');
      expect(json).not.toContain('password');
    });
  });

  describe('Lọc và phân trang', () => {
    it('q không phân biệt hoa/thường; q chứa ký tự regex không lỗi và không khớp bừa', async () => {
      expect(names(await assignees('admin', '?q=STAFFA'))).toEqual([
        'staffA1',
        'staffA2',
      ]);
      for (const q of ['.*', '(', '[a-z]', 'staff%2B']) {
        const res = await assignees('admin', `?q=${q}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
      }
    });

    it('teamId thu hẹp theo nhóm của người', async () => {
      expect(names(await assignees('admin', `?teamId=${ids.teamB}`))).toEqual([
        'staffB1',
        'staffBlocked',
      ]);
      expect(
        names(
          await assignees('admin', `?teamId=${String(new Types.ObjectId())}`),
        ),
      ).toEqual([]);
    });

    it('phân trang: limit 2 trang 2; limit 101, q > 50 ký tự, teamId sai định dạng, tham số purpose cũ ⇒ 400', async () => {
      const page2 = await assignees('admin', '?limit=2&page=2');
      expect(page2.status).toBe(200);
      // Admin thấy 6 người (mgrA đã được mời vào khách ở ca trước): trang 2 = staffA1, staffA2.
      expect(names(page2)).toEqual(['staffA1', 'staffA2']);
      expect(page2.body.meta).toEqual({
        total: 6,
        page: 2,
        limit: 2,
        totalPages: 3,
      });

      expect((await assignees('admin', '?limit=100')).status).toBe(200);
      expect((await assignees('admin', '?limit=101')).status).toBe(400);
      expect((await assignees('admin', `?q=${'a'.repeat(51)}`)).status).toBe(
        400,
      );
      expect((await assignees('admin', '?teamId=abc')).status).toBe(400);
      expect((await assignees('admin', '?purpose=filter')).status).toBe(400);
    });
  });

  describe('Không rate-limit riêng, route cũ đã xóa, Swagger', () => {
    it('gọi endpoint không tiêu thụ lượt rate-limit nào của CRM', async () => {
      const spy = jest
        .spyOn(rateLimitProto, 'consume')
        .mockResolvedValue(undefined);
      try {
        expect((await assignees('admin')).status).toBe(200);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('route danh sách người phân chăm sóc cũ đã bị xóa hẳn: 404', async () => {
      const res = await call('GET', '/crm/assignable-users', 'admin');
      expect(res.status).toBe(404);
    });

    it('Swagger có GET /api/v1/crm/customer-assignees và không còn route cũ', () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('qa').addBearerAuth().build(),
      );
      const route = doc.paths['/api/v1/crm/customer-assignees'];
      expect(route).toBeDefined();
      expect(Object.keys(route)).toEqual(['get']);
      expect(
        Object.keys(doc.paths).filter((path) =>
          path.includes('assignable-users'),
        ),
      ).toEqual([]);
    });
  });
});
