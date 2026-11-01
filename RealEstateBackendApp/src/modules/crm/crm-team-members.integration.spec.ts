/**
 * INTEGRATION — thành viên nhóm (`/teams/:id/members`) và nguồn lọc "Người phụ trách" của Quản lý
 * (`GET /crm/assignable-users?purpose=filter`), tài liệu 09 mục 6 và 6.10. HTTP thật (Fastify + guard toàn cục + MongoDB
 * Replica Set in-memory). Kiểm điều unit test mock không chứng minh được:
 * - quyền (ADMIN ghi; Quản lý chỉ xem nhóm mình quản lý; STAFF/EDITOR 403);
 * - thêm/gỡ đồng bộ `teamIds`/`teamId`, `customers.teamIds` (và phạm vi khách của Quản lý), audit, không đụng `managerIds`;
 * - role không thuộc nhóm bị từ chối;
 * - nguồn lọc của Quản lý = người trong careTeam của khách Quản lý được thấy, ô gán vẫn chặt.
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
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

type Method = 'GET' | 'POST' | 'DELETE';
type Res = { status: number; body: any };

describe('Thành viên nhóm + nguồn lọc người phụ trách — HTTP + MongoDB Replica Set', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const call = async (
    method: Method,
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
  const createCustomer = async (primary: string, members: string[] = []) => {
    const phone = `091${String(3_000_000 + ++phoneSeq)}`;
    const res = await call('POST', '/crm/customers', 'admin', {
      fullName: `Khách ${phone}`,
      phone,
      careTeam: {
        primaryUserId: ids[primary],
        memberIds: members.map((key) => ids[key]),
      },
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const customerTeamIds = async (customerId: string) =>
    (
      (await connection
        .collection('customers')
        .findOne({ _id: new Types.ObjectId(customerId) })) as any
    ).teamIds
      .map(String)
      .sort();
  const dbUser = (key: string) =>
    userModel.findById(ids[key]).lean() as Promise<any>;
  const dbTeam = (key: string) =>
    connection
      .collection('teams')
      .findOne({ _id: new Types.ObjectId(ids[key]) }) as Promise<any>;
  const memberNames = async (teamKey: string, as = 'admin') => {
    const res = await call(
      'GET',
      `/teams/${ids[teamKey]}/members?limit=100`,
      as,
    );
    expect(res.status).toBe(200);
    return res.body.data
      .map((m: { displayName: string }) => m.displayName)
      .sort();
  };
  const assigneeNames = async (as: string, purpose?: string) => {
    const res = await call(
      'GET',
      `/crm/assignable-users?limit=100${purpose ? `&purpose=${purpose}` : ''}`,
      as,
    );
    expect(res.status).toBe(200);
    return res.body.data
      .map((u: { displayName: string }) => u.displayName)
      .sort();
  };
  const visibleCustomers = async (as: string) => {
    const res = await call('GET', '/crm/customers?limit=100', as);
    expect(res.status).toBe(200);
    return res.body.data.map((c: { id: string }) => c.id);
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-members-${RUN_ID}:`;
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

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('mgrA', UserRole.MANAGER);
    await createUser('mgrB', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('staffNew', UserRole.STAFF);

    const teamA = await call('POST', '/teams', 'admin', {
      name: 'Nhóm A',
      code: 'TA',
      managerIds: [ids.mgrA],
    });
    const teamB = await call('POST', '/teams', 'admin', {
      name: 'Nhóm B',
      code: 'TB',
      managerIds: [ids.mgrB],
    });
    expect([teamA.status, teamB.status]).toEqual([201, 201]);
    ids.teamA = teamA.body.data.id;
    ids.teamB = teamB.body.data.id;
    for (const [user, team] of [
      ['staffA', 'teamA'],
      ['staffB', 'teamB'],
      ['staffC', 'teamB'],
    ] as const) {
      const res = await call('POST', `/teams/${ids[team]}/members`, 'admin', {
        userId: ids[user],
      });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  describe('Quyền', () => {
    it('STAFF/EDITOR: 403 cả 3 route; MANAGER: xem nhóm mình quản lý được, nhóm khác 403, thêm/gỡ 403', async () => {
      for (const as of ['staffA', 'editor']) {
        expect(
          (await call('GET', `/teams/${ids.teamA}/members`, as)).status,
        ).toBe(403);
        expect(
          (
            await call('POST', `/teams/${ids.teamA}/members`, as, {
              userId: ids.staffNew,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await call(
              'DELETE',
              `/teams/${ids.teamA}/members/${ids.staffA}`,
              as,
            )
          ).status,
        ).toBe(403);
      }
      expect(
        (await call('GET', `/teams/${ids.teamA}/members`, 'mgrA')).status,
      ).toBe(200);
      expect(
        (await call('GET', `/teams/${ids.teamA}/members`, 'mgrB')).status,
      ).toBe(403);
      expect(
        (
          await call('POST', `/teams/${ids.teamA}/members`, 'mgrA', {
            userId: ids.staffNew,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            'DELETE',
            `/teams/${ids.teamA}/members/${ids.staffA}`,
            'mgrA',
          )
        ).status,
      ).toBe(403);
      // Không có gì bị ghi.
      expect((await dbUser('staffNew')).teamIds).toEqual([]);
      expect((await dbUser('staffA')).teamIds.map(String)).toEqual([ids.teamA]);
    });

    it('GET trả { data, meta } chuẩn, không lộ email; id sai 400, nhóm không tồn tại 404', async () => {
      const res = await call('GET', `/teams/${ids.teamA}/members`, 'admin');
      expect(res.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(res.body.data).toEqual([
        {
          id: ids.staffA,
          displayName: 'staffA',
          role: 'STAFF',
          roles: ['STAFF'],
          status: 'ACTIVE',
          isManager: false,
        },
      ]);
      expect(
        (await call('GET', '/teams/not-an-id/members', 'admin')).status,
      ).toBe(400);
      expect(
        (
          await call(
            'GET',
            `/teams/${String(new Types.ObjectId())}/members`,
            'admin',
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('Thêm / gỡ thành viên', () => {
    let customerId: string;

    it('thêm: đồng bộ teamIds/teamId, customers.teamIds, phạm vi khách của Quản lý, audit, memberCount; thêm trùng không tạo bản ghi trùng', async () => {
      // staffNew chưa có nhóm nên khách của họ chưa thuộc nhóm nào và Quản lý A chưa thấy.
      customerId = await createCustomer('staffNew');
      expect(await customerTeamIds(customerId)).toEqual([]);
      expect(await visibleCustomers('mgrA')).not.toContain(customerId);

      const res = await call('POST', `/teams/${ids.teamA}/members`, 'admin', {
        userId: ids.staffNew,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: ids.staffNew,
        displayName: 'staffNew',
        role: 'STAFF',
        roles: ['STAFF'],
        status: 'ACTIVE',
        isManager: false,
      });

      const user = await dbUser('staffNew');
      expect([user.teamIds.map(String), String(user.teamId)]).toEqual([
        [ids.teamA],
        ids.teamA,
      ]);
      expect(await customerTeamIds(customerId)).toEqual([ids.teamA]);
      expect(await visibleCustomers('mgrA')).toContain(customerId);
      expect(await memberNames('teamA')).toEqual(['staffA', 'staffNew']);

      const teams = await call('GET', '/teams', 'admin');
      const teamA = teams.body.data.find(
        (t: { id: string }) => t.id === ids.teamA,
      );
      expect(teamA.memberCount).toBe(2);

      const audits = (await connection
        .collection('crm_audit_logs')
        .find({
          entityId: new Types.ObjectId(ids.staffNew),
          action: 'USER_TEAM_CHANGED',
        })
        .toArray()) as any[];
      expect(audits).toHaveLength(1);
      expect(audits[0].changes).toEqual([
        { field: 'teamIds', from: [], to: [ids.teamA] },
      ]);

      // Thêm lần hai: vẫn thành công nhưng không ghi thêm gì.
      const again = await call('POST', `/teams/${ids.teamA}/members`, 'admin', {
        userId: ids.staffNew,
      });
      expect(again.status).toBe(201);
      expect((await dbUser('staffNew')).teamIds).toHaveLength(1);
      expect(
        await connection.collection('crm_audit_logs').countDocuments({
          entityId: new Types.ObjectId(ids.staffNew),
          action: 'USER_TEAM_CHANGED',
        }),
      ).toBe(1);
    });

    it('từ chối: role ngoài MANAGER/STAFF 400; người/nhóm không tồn tại 404; body sai 400', async () => {
      for (const user of ['editor', 'admin']) {
        const res = await call('POST', `/teams/${ids.teamA}/members`, 'admin', {
          userId: ids[user],
        });
        expect([res.status, res.body.errorCode]).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
        expect((await dbUser(user)).teamIds ?? []).toEqual([]);
      }
      expect(
        (
          await call('POST', `/teams/${ids.teamA}/members`, 'admin', {
            userId: new Types.ObjectId(),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            'POST',
            `/teams/${String(new Types.ObjectId())}/members`,
            'admin',
            { userId: ids.staffA },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call('POST', `/teams/${ids.teamA}/members`, 'admin', {
            userId: 'x',
          })
        ).status,
      ).toBe(400);
    });

    it('gỡ: xóa khỏi teamIds, nhóm chính kế tiếp lên thay, customers.teamIds và phạm vi Quản lý tính lại NGAY; gỡ lại là no-op', async () => {
      // Người ở hai nhóm: gỡ khỏi nhóm chính (A) thì nhóm B thành nhóm chính.
      await call('POST', `/teams/${ids.teamB}/members`, 'admin', {
        userId: ids.staffNew,
      });
      expect(await customerTeamIds(customerId)).toEqual(
        [ids.teamA, ids.teamB].sort(),
      );

      const removeA = await call(
        'DELETE',
        `/teams/${ids.teamA}/members/${ids.staffNew}`,
        'admin',
      );
      expect(removeA.status).toBe(204);
      const user = await dbUser('staffNew');
      expect([user.teamIds.map(String), String(user.teamId)]).toEqual([
        [ids.teamB],
        ids.teamB,
      ]);
      expect(await customerTeamIds(customerId)).toEqual([ids.teamB]);
      expect(await visibleCustomers('mgrA')).not.toContain(customerId);
      expect(await memberNames('teamA')).toEqual(['staffA']);

      const removeB = await call(
        'DELETE',
        `/teams/${ids.teamB}/members/${ids.staffNew}`,
        'admin',
      );
      expect(removeB.status).toBe(204);
      const after = await dbUser('staffNew');
      expect([after.teamIds, after.teamId]).toEqual([[], null]);
      expect(await customerTeamIds(customerId)).toEqual([]);

      const noop = await call(
        'DELETE',
        `/teams/${ids.teamB}/members/${ids.staffNew}`,
        'admin',
      );
      expect(noop.status).toBe(204);
      expect(
        (
          await call(
            'DELETE',
            `/teams/${String(new Types.ObjectId())}/members/${ids.staffNew}`,
            'admin',
          )
        ).status,
      ).toBe(404);
    });

    it('Quản lý nhóm làm thành viên: hiện isManager=true; gỡ thành viên KHÔNG gỡ quyền Quản lý (managerIds giữ nguyên)', async () => {
      const add = await call('POST', `/teams/${ids.teamA}/members`, 'admin', {
        userId: ids.mgrA,
      });
      expect([add.status, add.body.data.isManager, add.body.data.role]).toEqual(
        [201, true, 'MANAGER'],
      );

      expect(
        (
          await call(
            'DELETE',
            `/teams/${ids.teamA}/members/${ids.mgrA}`,
            'admin',
          )
        ).status,
      ).toBe(204);
      expect((await dbUser('mgrA')).teamIds).toEqual([]);
      expect((await dbTeam('teamA')).managerIds.map(String)).toEqual([
        ids.mgrA,
      ]);
      // Vẫn quản lý được nhóm A (xem thành viên).
      expect(
        (await call('GET', `/teams/${ids.teamA}/members`, 'mgrA')).status,
      ).toBe(200);
    });
  });

  describe('Nguồn lọc "Người phụ trách" của Quản lý (purpose=filter)', () => {
    it('Quản lý thấy người trong careTeam của khách mình được thấy (kể cả người ở nhóm mình không quản lý), không thấy người ngoài tập đó; ô gán vẫn chặt', async () => {
      // c1: staffA (nhóm A) + staffB (nhóm B) => teamIds {A, B}: Quản lý A và Quản lý B cùng thấy.
      // c2: chỉ staffC (nhóm B) => Quản lý A KHÔNG thấy.
      const c1 = await createCustomer('staffA', ['staffB']);
      const c2 = await createCustomer('staffC');
      const visibleToA = await visibleCustomers('mgrA');
      expect(visibleToA).toContain(c1);
      expect(visibleToA).not.toContain(c2);

      expect(await assigneeNames('mgrA', 'filter')).toEqual([
        'staffA',
        'staffB',
      ]);
      // Ô gán: chỉ người thuộc nhóm mình QUẢN LÝ (staffB ở nhóm B không được gán).
      expect(await assigneeNames('mgrA')).toEqual(['staffA']);
      expect(await assigneeNames('mgrA', 'assign')).toEqual(['staffA']);
      expect(await assigneeNames('mgrB', 'filter')).toEqual([
        'staffA',
        'staffB',
        'staffC',
      ]);
    });

    it('trả shape phân trang chuẩn, không lộ email; q thu hẹp trong tập; purpose lạ 400', async () => {
      const res = await call(
        'GET',
        '/crm/assignable-users?purpose=filter&q=staffb',
        'mgrA',
      );
      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        displayName: 'staffB',
        role: 'STAFF',
      });
      expect(JSON.stringify(res.body)).not.toContain('@test.vn');

      expect(
        (await call('GET', '/crm/assignable-users?purpose=other', 'mgrA'))
          .status,
      ).toBe(400);
    });

    it('ADMIN và STAFF giữ hành vi gán hiện tại khi gửi purpose=filter', async () => {
      expect(await assigneeNames('admin', 'filter')).toEqual(
        await assigneeNames('admin'),
      );
      expect(await assigneeNames('staffA', 'filter')).toEqual(
        await assigneeNames('staffA'),
      );
      expect(await assigneeNames('staffA', 'filter')).toEqual(['staffA']);
      expect(
        (await call('GET', '/crm/assignable-users?purpose=filter', 'editor'))
          .status,
      ).toBe(403);
    });
  });
});
