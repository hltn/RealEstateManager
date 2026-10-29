/**
 * INTEGRATION — một tài khoản NHIỀU role và NHIỀU nhóm, qua HTTP thật (Fastify + guard toàn cục + MongoDB Replica Set
 * in-memory). Kiểm những điều unit test mock không chứng minh được:
 * - phạm vi khách theo role CAO NHẤT (MANAGER+STAFF → phạm vi MANAGER; ADMIN+STAFF → tất cả; STAFF+EDITOR → phạm vi STAFF);
 * - RolesGuard hợp quyền các role + token cũ chỉ có `role`;
 * - `customers.teamIds` = hợp nhóm của mọi thành viên chăm sóc, đồng bộ khi đổi nhóm/đổi role;
 * - `PATCH /users/:id/roles|teams` (lỗi 400/404, gỡ managerIds, xóa nhóm khi mất role MANAGER/STAFF, audit);
 * - người nhiều nhóm/nhiều role xuất hiện đúng trong `assignable-users`.
 *
 * Các `it` trong cùng file dùng chung dữ liệu và chạy THEO THỨ TỰ. Chạy bằng `npm run test:integration`.
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
import { TeamsService } from '../teams/teams.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

type Res = { status: number; body: any };

describe('Nhiều role + nhiều nhóm — HTTP + MongoDB Replica Set', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const request = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    token: string | null,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    as: string | null,
    body?: unknown,
  ) => request(method, url, as ? tokens[as] : null, body);

  /** Token đủ roles (role = cao nhất như AuthService cấp). */
  const signFor = (key: string, roles: UserRole[], role: UserRole = roles[0]) =>
    jwt.sign({ sub: ids[key], email: `${key}@test.vn`, role, roles });

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
    tokens[key] = signFor(key, roles);
  };

  let phoneSeq = 0;
  const createCustomer = async (primary: string, members: string[] = []) => {
    const phone = `091${String(2_000_000 + ++phoneSeq)}`;
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
  const listIds = async (as: string | null, token?: string) => {
    const res = token
      ? await request('GET', '/crm/customers?limit=100', token)
      : await call('GET', '/crm/customers?limit=100', as);
    expect(res.status).toBe(200);
    return res.body.data.map((item: { id: string }) => item.id).sort();
  };
  const dbUser = (key: string) =>
    userModel.findById(ids[key]).lean() as Promise<any>;
  const sorted = (values: string[]) => [...values].sort();

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-multi-${RUN_ID}:`;
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

    await createUser('admin', [UserRole.ADMIN]);
    await createUser('editorOnly', [UserRole.EDITOR]);
    await createUser('mgrStaff', [UserRole.MANAGER, UserRole.STAFF]);
    await createUser('adminStaff', [UserRole.ADMIN, UserRole.STAFF]);
    await createUser('staffEditor', [UserRole.STAFF, UserRole.EDITOR]);
    await createUser('staffA', [UserRole.STAFF]);
    await createUser('staffB', [UserRole.STAFF]);
    await createUser('multiTeam', [UserRole.STAFF]);

    const teamA = await call('POST', '/teams', 'admin', {
      name: 'Nhóm A',
      code: 'MA',
      // Người có role MANAGER+STAFF đủ điều kiện làm Quản lý nhóm.
      managerIds: [ids.mgrStaff],
    });
    expect(teamA.status).toBe(201);
    const teamB = await call('POST', '/teams', 'admin', {
      name: 'Nhóm B',
      code: 'MB',
    });
    ids.teamA = teamA.body.data.id;
    ids.teamB = teamB.body.data.id;
    for (const [user, teams] of [
      ['mgrStaff', [ids.teamA]],
      ['staffEditor', [ids.teamA]],
      ['staffA', [ids.teamA]],
      ['staffB', [ids.teamB]],
      ['multiTeam', [ids.teamA, ids.teamB]],
    ] as const) {
      const res = await call('PATCH', `/users/${ids[user]}/teams`, 'admin', {
        teamIds: teams,
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

  describe('Tạo/lọc tài khoản (roles[]/teamIds[] và cách viết tắt role/teamId)', () => {
    it('POST /users nhận roles[]+teamIds[]: role = cao nhất, teamId = nhóm đầu, trả cả hai cặp', async () => {
      const res = await call('POST', '/users', 'admin', {
        email: 'multi@test.vn',
        password: 'Passw0rd!123',
        displayName: 'Multi',
        roles: ['STAFF', 'MANAGER'],
        teamIds: [ids.teamB, ids.teamA],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        role: 'MANAGER',
        roles: ['MANAGER', 'STAFF'],
        teamId: ids.teamB,
        teamIds: [ids.teamB, ids.teamA],
      });
      expect(JSON.stringify(res.body)).not.toContain('password');
      ids.multi = res.body._id;
    });

    it('POST /users viết tắt role/teamId (hợp đồng cũ của frontend) = roles=[role], teamIds=[teamId]', async () => {
      const res = await call('POST', '/users', 'admin', {
        email: 'legacy-shape@test.vn',
        password: 'Passw0rd!123',
        displayName: 'Legacy',
        role: 'STAFF',
        teamId: ids.teamA,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        role: 'STAFF',
        roles: ['STAFF'],
        teamId: ids.teamA,
        teamIds: [ids.teamA],
      });
      ids.legacyShape = res.body._id;
    });

    it('thiếu cả role lẫn roles → 400; roles trùng/rỗng → 400; có nhóm mà không có role MANAGER/STAFF → 400', async () => {
      const base = {
        email: 'bad@test.vn',
        password: 'Passw0rd!123',
        displayName: 'Bad',
      };
      for (const body of [
        base,
        { ...base, roles: [] },
        { ...base, roles: ['STAFF', 'STAFF'] },
        { ...base, roles: ['ADMIN', 'EDITOR'], teamIds: [ids.teamA] },
      ]) {
        expect((await call('POST', '/users', 'admin', body)).status).toBe(400);
      }
    });

    it('gửi cả role lẫn roles (hoặc teamId lẫn teamIds) mâu thuẫn → 400 nêu rõ lý do, không tạo tài khoản', async () => {
      const base = {
        password: 'Passw0rd!123',
        displayName: 'Conflict',
      };
      const roleConflict = await call('POST', '/users', 'admin', {
        ...base,
        email: 'conflict-role@test.vn',
        role: 'STAFF',
        roles: ['MANAGER', 'STAFF'],
      });
      expect(roleConflict.status).toBe(400);
      expect(JSON.stringify(roleConflict.body)).toContain('role cao nhất');

      const teamConflict = await call('POST', '/users', 'admin', {
        ...base,
        email: 'conflict-team@test.vn',
        roles: ['STAFF'],
        teamId: ids.teamA,
        teamIds: [ids.teamB, ids.teamA],
      });
      expect(teamConflict.status).toBe(400);
      expect(JSON.stringify(teamConflict.body)).toContain('teamIds');

      expect(
        await userModel.countDocuments({
          email: { $in: ['conflict-role@test.vn', 'conflict-team@test.vn'] },
        }),
      ).toBe(0);

      // Nhất quán thì được chấp nhận (role = cao nhất, teamId = teamIds[0]).
      const ok = await call('POST', '/users', 'admin', {
        ...base,
        email: 'consistent@test.vn',
        role: 'MANAGER',
        roles: ['STAFF', 'MANAGER'],
        teamId: ids.teamB,
        teamIds: [ids.teamB, ids.teamA],
      });
      expect(ok.status).toBe(201);
      await userModel.deleteOne({ email: 'consistent@test.vn' });
    });

    it('GET /users?role= lọc theo "có role đó", ?teamId= theo "thuộc nhóm đó" (người nhiều role/nhóm xuất hiện ở mọi nơi hợp lệ)', async () => {
      const byRole = await call(
        'GET',
        '/users?role=MANAGER&limit=100',
        'admin',
      );
      expect(byRole.body.data.map((u: any) => u.email).sort()).toEqual(
        ['mgrstaff@test.vn', 'multi@test.vn'].sort(),
      );
      const byTeam = await call(
        'GET',
        `/users?teamId=${ids.teamB}&limit=100`,
        'admin',
      );
      expect(byTeam.body.data.map((u: any) => u.email).sort()).toEqual(
        ['multi@test.vn', 'multiteam@test.vn', 'staffb@test.vn'].sort(),
      );
    });
  });

  describe('RolesGuard: hợp quyền các role, token cũ chỉ có role', () => {
    it('STAFF+EDITOR vào được route CRM; EDITOR-only bị chặn; ADMIN-only route chặn STAFF+EDITOR', async () => {
      expect((await call('GET', '/crm/customers', 'staffEditor')).status).toBe(
        200,
      );
      expect((await call('GET', '/crm/customers', 'editorOnly')).status).toBe(
        403,
      );
      expect((await call('GET', '/users', 'staffEditor')).status).toBe(403);
    });

    it('token cũ chỉ có `role` (không có roles) vẫn dùng được; phạm vi lấy từ DB, không từ token', async () => {
      const legacy = jwt.sign({
        sub: ids.mgrStaff,
        email: 'mgrstaff@test.vn',
        role: UserRole.STAFF, // token cũ ghi STAFF, DB là MANAGER+STAFF
      });
      expect((await request('GET', '/crm/customers', legacy)).status).toBe(200);
    });

    it('ActiveAdminGuard theo DB: ADMIN+STAFF ghi được route chỉ-Quản-trị; MANAGER+STAFF thì không dù token ghi ADMIN', async () => {
      expect(
        (
          await call('POST', '/teams', 'adminStaff', {
            name: 'Nhóm C',
            code: 'MC',
          })
        ).status,
      ).toBe(201);
      const forged = signFor('mgrStaff', [UserRole.ADMIN]);
      expect(
        (
          await request('POST', '/teams', forged, {
            name: 'Nhóm D',
            code: 'MD',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('Phạm vi khách theo role cao nhất + teamIds nhiều nhóm', () => {
    let cA: string; // staffA (nhóm A)
    let cB: string; // staffB (nhóm B)
    let cMulti: string; // multiTeam (nhóm A + B)

    beforeAll(async () => {
      cA = await createCustomer('staffA');
      cB = await createCustomer('staffB');
      cMulti = await createCustomer('multiTeam');
    });

    it('customers.teamIds = hợp teamIds của MỌI thành viên chăm sóc (kể cả người nhiều nhóm)', async () => {
      expect(await customerTeamIds(cA)).toEqual([ids.teamA]);
      expect(await customerTeamIds(cMulti)).toEqual(
        sorted([ids.teamA, ids.teamB]),
      );
      const both = await createCustomer('staffA', ['staffB']);
      expect(await customerTeamIds(both)).toEqual(
        sorted([ids.teamA, ids.teamB]),
      );
    });

    it('MANAGER+STAFF → phạm vi MANAGER (khách của nhóm mình quản lý dù không có trong careTeam); STAFF+EDITOR → phạm vi STAFF; ADMIN+STAFF → tất cả', async () => {
      const managed = await listIds('mgrStaff');
      expect(managed).toEqual(expect.arrayContaining([cA, cMulti]));
      expect(managed).not.toContain(cB);

      // Cùng thuộc nhóm A nhưng không là Quản lý: không thấy khách nào của người khác.
      expect(await listIds('staffEditor')).toEqual([]);
      const own = await listIds('staffA');
      expect(own).toContain(cA);
      expect(own).not.toEqual(expect.arrayContaining([cB, cMulti]));

      const all = await listIds('adminStaff');
      expect(all).toEqual(expect.arrayContaining([cA, cB, cMulti]));
    });

    it('đổi nhóm của người chăm sóc (PATCH /users/:id/teams) tính lại customers.teamIds NGAY; phạm vi Quản lý đổi theo', async () => {
      const res = await call(
        'PATCH',
        `/users/${ids.multiTeam}/teams`,
        'admin',
        { teamIds: [ids.teamB] },
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        teamId: ids.teamB,
        teamIds: [ids.teamB],
      });
      expect(await customerTeamIds(cMulti)).toEqual([ids.teamB]);
      expect(await listIds('mgrStaff')).not.toContain(cMulti);

      await call('PATCH', `/users/${ids.multiTeam}/teams`, 'admin', {
        teamIds: [ids.teamA, ids.teamB],
      });
      expect(await customerTeamIds(cMulti)).toEqual(
        sorted([ids.teamA, ids.teamB]),
      );
      expect(await listIds('mgrStaff')).toContain(cMulti);
    });

    it('assignable-users: lọc theo bất kỳ nhóm nào của người nhiều nhóm; chỉ người có role MANAGER/STAFF; trả roles/teamIds, role giữ hợp đồng MANAGER/STAFF', async () => {
      const teamB = await call(
        'GET',
        `/crm/assignable-users?teamId=${ids.teamB}&limit=100`,
        'admin',
      );
      expect(teamB.body.data.map((u: any) => u.id).sort()).toEqual(
        sorted([ids.staffB, ids.multiTeam, ids.multi]),
      );
      const teamA = await call(
        'GET',
        `/crm/assignable-users?teamId=${ids.teamA}&limit=100`,
        'admin',
      );
      const byId = new Map(teamA.body.data.map((u: any) => [u.id, u]));
      expect([...byId.keys()].sort()).toEqual(
        sorted([
          ids.mgrStaff,
          ids.staffEditor,
          ids.staffA,
          ids.multiTeam,
          ids.multi,
          ids.legacyShape,
        ]),
      );
      expect(byId.get(ids.mgrStaff)).toMatchObject({
        role: 'MANAGER',
        roles: ['MANAGER', 'STAFF'],
        teamIds: [ids.teamA],
      });
      expect(byId.get(ids.staffEditor)).toMatchObject({
        role: 'STAFF',
        roles: ['STAFF', 'EDITOR'],
      });
      expect(byId.get(ids.multiTeam)).toMatchObject({
        teamIds: [ids.teamA, ids.teamB],
      });

      // ADMIN+STAFF thuộc nhóm thì xuất hiện với role STAFF; ADMIN-only/EDITOR-only không bao giờ có mặt.
      await call('PATCH', `/users/${ids.adminStaff}/teams`, 'admin', {
        teamIds: [ids.teamA],
      });
      const again = await call(
        'GET',
        `/crm/assignable-users?teamId=${ids.teamA}&limit=100`,
        'admin',
      );
      expect(
        again.body.data.find((u: any) => u.id === ids.adminStaff),
      ).toMatchObject({ role: 'STAFF' });
      expect(again.body.data.map((u: any) => u.id)).not.toContain(ids.admin);
      expect(again.body.data.map((u: any) => u.id)).not.toContain(
        ids.editorOnly,
      );
    });
  });

  describe('PATCH /users/:id/teams (+ /team cũ)', () => {
    it('role không thuộc nhóm → 400; nhóm không tồn tại → 404; nhóm đã ngừng → 404; dữ liệu không đổi', async () => {
      const before = await dbUser('staffA');
      expect(
        (
          await call('PATCH', `/users/${ids.editorOnly}/teams`, 'admin', {
            teamIds: [ids.teamA],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.staffA}/teams`, 'admin', {
            teamIds: [new Types.ObjectId().toHexString()],
          })
        ).status,
      ).toBe(404);

      const inactive = await call('POST', '/teams', 'admin', {
        name: 'Ngừng',
        code: 'MZ',
      });
      await call('PATCH', `/teams/${inactive.body.data.id}`, 'admin', {
        isActive: false,
      });
      expect(
        (
          await call('PATCH', `/users/${ids.staffA}/teams`, 'admin', {
            teamIds: [ids.teamA, inactive.body.data.id],
          })
        ).status,
      ).toBe(404);
      expect(await dbUser('staffA')).toEqual(before);
    });

    it('chỉ ADMIN: STAFF/MANAGER gọi → 403; trùng id → 400', async () => {
      expect(
        (
          await call('PATCH', `/users/${ids.staffA}/teams`, 'staffA', {
            teamIds: [ids.teamA],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('PATCH', `/users/${ids.staffA}/teams`, 'admin', {
            teamIds: [ids.teamA, ids.teamA],
          })
        ).status,
      ).toBe(400);
    });

    it('thứ tự quyết định nhóm chính; audit USER_TEAM_CHANGED ghi teamIds cũ/mới; đặt lại cùng danh sách là no-op không audit', async () => {
      await call('PATCH', `/users/${ids.multiTeam}/teams`, 'admin', {
        teamIds: [ids.teamB, ids.teamA],
      });
      expect((await dbUser('multiTeam')).teamId.toString()).toBe(ids.teamB);

      const countAudit = () =>
        connection.collection('crm_audit_logs').countDocuments({
          entityId: new Types.ObjectId(ids.multiTeam),
          action: 'USER_TEAM_CHANGED',
        });
      const before = await countAudit();
      await call('PATCH', `/users/${ids.multiTeam}/teams`, 'admin', {
        teamIds: [ids.teamB, ids.teamA],
      });
      expect(await countAudit()).toBe(before);

      const last = (await connection
        .collection('crm_audit_logs')
        .find({
          entityId: new Types.ObjectId(ids.multiTeam),
          action: 'USER_TEAM_CHANGED',
        })
        .sort({ _id: -1 })
        .limit(1)
        .toArray()) as any[];
      expect(last[0].changes).toEqual([
        {
          field: 'teamIds',
          from: [ids.teamA, ids.teamB],
          to: [ids.teamB, ids.teamA],
        },
      ]);
    });

    it('PATCH /team (hợp đồng cũ): {teamId} đặt teamIds=[teamId], {teamId:null} gỡ khỏi mọi nhóm', async () => {
      const set = await call('PATCH', `/users/${ids.multiTeam}/team`, 'admin', {
        teamId: ids.teamA,
      });
      expect(set.body.data).toMatchObject({
        teamId: ids.teamA,
        teamIds: [ids.teamA],
      });
      const cleared = await call(
        'PATCH',
        `/users/${ids.multiTeam}/team`,
        'admin',
        { teamId: null },
      );
      expect(cleared.body.data).toMatchObject({ teamId: null, teamIds: [] });
    });
  });

  describe('TeamsService.addUserToTeam / removeUserFromTeam (dùng cho việc thêm/gỡ thành viên nhóm, chưa có route)', () => {
    it('thêm vào nhóm giữ nguyên nhóm chính và các nhóm khác, đồng bộ customers.teamIds; thêm lại là no-op', async () => {
      const teams = app.get(TeamsService);
      const actor = { sub: ids.admin };
      const customer = await createCustomer('staffB');
      expect(await customerTeamIds(customer)).toEqual([ids.teamB]);

      const added = await teams.addUserToTeam(actor, ids.staffB, ids.teamA);
      expect(added).toMatchObject({
        teamId: ids.teamB,
        teamIds: [ids.teamB, ids.teamA],
      });
      expect(await customerTeamIds(customer)).toEqual(
        sorted([ids.teamA, ids.teamB]),
      );

      const auditCount = () =>
        connection.collection('crm_audit_logs').countDocuments({
          entityId: new Types.ObjectId(ids.staffB),
          action: 'USER_TEAM_CHANGED',
        });
      const before = await auditCount();
      await teams.addUserToTeam(actor, ids.staffB, ids.teamA);
      expect(await auditCount()).toBe(before);
    });

    it('gỡ khỏi nhóm chính thì nhóm kế tiếp thành nhóm chính; gỡ nhóm không thuộc là no-op; vai trò không thuộc nhóm bị từ chối khi thêm', async () => {
      const teams = app.get(TeamsService);
      const actor = { sub: ids.admin };

      const removed = await teams.removeUserFromTeam(
        actor,
        ids.staffB,
        ids.teamB,
      );
      expect(removed).toMatchObject({
        teamId: ids.teamA,
        teamIds: [ids.teamA],
      });
      const again = await teams.removeUserFromTeam(
        actor,
        ids.staffB,
        ids.teamB,
      );
      expect(again.teamIds).toEqual([ids.teamA]);

      await expect(
        teams.addUserToTeam(actor, ids.editorOnly, ids.teamA),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });

      // trả staffB về nhóm B để không ảnh hưởng các test sau
      await call('PATCH', `/users/${ids.staffB}/team`, 'admin', {
        teamId: ids.teamB,
      });
    });
  });

  describe('assignable-users khớp đúng luật phân chăm sóc (không liệt kê người mà thao tác phân sẽ bị từ chối)', () => {
    beforeAll(async () => {
      await createUser('mgrX', [UserRole.MANAGER]);
      await createUser('staffC', [UserRole.STAFF]);
      const teamC = await call('POST', '/teams', 'admin', {
        name: 'Nhóm X',
        code: 'MXC',
        managerIds: [ids.mgrX],
      });
      expect(teamC.status).toBe(201);
      ids.teamC = teamC.body.data.id;
      expect(
        (
          await call('PATCH', `/users/${ids.staffC}/teams`, 'admin', {
            teamIds: [ids.teamC],
          })
        ).status,
      ).toBe(200);
      // mgrX QUẢN LÝ nhóm C nhưng chỉ là THÀNH VIÊN nhóm B.
      expect(
        (
          await call('PATCH', `/users/${ids.mgrX}/teams`, 'admin', {
            teamIds: [ids.teamB],
          })
        ).status,
      ).toBe(200);
    });

    const assignableIds = async (as: string, query = '') => {
      const res = await call(
        'GET',
        `/crm/assignable-users?limit=100${query}`,
        as,
      );
      expect(res.status).toBe(200);
      return res.body.data.map((u: any) => u.id).sort();
    };

    it('Quản lý chỉ thấy người thuộc nhóm mình QUẢN LÝ + chính mình; thành viên nhóm B (chỉ là thành viên) không có trong danh sách', async () => {
      expect(await assignableIds('mgrX')).toEqual(
        sorted([ids.staffC, ids.mgrX]),
      );
      // Lọc theo nhóm B (ngoài phạm vi phân) → rỗng, không dùng để dò người.
      expect(await assignableIds('mgrX', `&teamId=${ids.teamB}`)).toEqual([]);
    });

    it('danh sách khớp thao tác: phân người trong danh sách → 201; phân người ngoài danh sách → 400 USER_NOT_ASSIGNABLE', async () => {
      const outside = await call('POST', '/crm/customers', 'mgrX', {
        fullName: 'Khách ngoài phạm vi phân',
        phone: '0913555001',
        careTeam: { primaryUserId: ids.staffB, memberIds: [] },
      });
      expect([outside.status, outside.body.errorCode]).toEqual([
        400,
        'USER_NOT_ASSIGNABLE',
      ]);

      const inside = await call('POST', '/crm/customers', 'mgrX', {
        fullName: 'Khách trong phạm vi phân',
        phone: '0913555002',
        careTeam: { primaryUserId: ids.staffC, memberIds: [ids.mgrX] },
      });
      expect(inside.status).toBe(201);
    });

    it('Nhân viên thấy người cùng nhóm (kể cả Quản lý là thành viên nhóm đó) và không thấy nhóm khác', async () => {
      const staffBView = await assignableIds('staffB');
      expect(staffBView).toEqual(
        expect.arrayContaining([ids.staffB, ids.multi, ids.mgrX]),
      );
      expect(staffBView).not.toContain(ids.staffC);
      expect(await assignableIds('staffC')).toEqual([ids.staffC]);
    });

    it('Quản trị vẫn thấy tất cả; EDITOR-only vẫn bị chặn 403', async () => {
      const all = await assignableIds('admin');
      expect(all).toEqual(
        expect.arrayContaining([ids.mgrX, ids.staffC, ids.staffB]),
      );
      expect(
        (await call('GET', '/crm/assignable-users', 'editorOnly')).status,
      ).toBe(403);
    });
  });

  describe('PATCH /users/:id/roles (+ /role cũ)', () => {
    it('chỉ ADMIN; roles rỗng/trùng/giá trị lạ → 400', async () => {
      expect(
        (
          await call('PATCH', `/users/${ids.staffA}/roles`, 'mgrStaff', {
            roles: ['STAFF'],
          })
        ).status,
      ).toBe(403);
      for (const roles of [[], ['STAFF', 'STAFF'], ['SUPERUSER']]) {
        expect(
          (
            await call('PATCH', `/users/${ids.staffA}/roles`, 'admin', {
              roles,
            })
          ).status,
        ).toBe(400);
      }
    });

    it('bỏ role MANAGER (còn STAFF): gỡ khỏi managerIds nhưng GIỮ nhóm; audit USER_ROLE_CHANGED ghi roles cũ/mới', async () => {
      const res = await call('PATCH', `/users/${ids.mgrStaff}/roles`, 'admin', {
        roles: ['STAFF'],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        role: 'STAFF',
        roles: ['STAFF'],
        teamIds: [ids.teamA],
      });
      const team = (await connection
        .collection('teams')
        .findOne({ _id: new Types.ObjectId(ids.teamA) })) as any;
      expect(team.managerIds.map(String)).not.toContain(ids.mgrStaff);

      const audit = (await connection
        .collection('crm_audit_logs')
        .find({
          entityId: new Types.ObjectId(ids.mgrStaff),
          action: 'USER_ROLE_CHANGED',
        })
        .toArray()) as any[];
      expect(audit[0].changes).toEqual([
        { field: 'roles', from: ['MANAGER', 'STAFF'], to: ['STAFF'] },
      ]);
    });

    it('không còn role MANAGER/STAFF: xóa nhóm (teamIds=[], teamId=null) và tính lại customers.teamIds NGAY', async () => {
      // staffB (nhóm B) + staffEditor (nhóm A) cùng chăm sóc: teamIds = {A, B}.
      const customer = await createCustomer('staffB', ['staffEditor']);
      expect(await customerTeamIds(customer)).toEqual(
        sorted([ids.teamA, ids.teamB]),
      );

      const res = await call(
        'PATCH',
        `/users/${ids.staffEditor}/roles`,
        'admin',
        { roles: ['EDITOR'] },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        role: 'EDITOR',
        roles: ['EDITOR'],
        teamId: null,
        teamIds: [],
      });
      // Người bị mất nhóm không còn đóng góp teamIds của khách (staffB vẫn ở nhóm B).
      expect(await customerTeamIds(customer)).toEqual([ids.teamB]);

      // EDITOR-only không còn được phân chăm sóc.
      const assign = await call('POST', '/crm/customers', 'admin', {
        fullName: 'Khách không phân được',
        phone: '0913999888',
        careTeam: { primaryUserId: ids.staffEditor, memberIds: [] },
      });
      expect([assign.status, assign.body.errorCode]).toEqual([
        400,
        'USER_NOT_ASSIGNABLE',
      ]);
    });

    it('PATCH /role (hợp đồng cũ) đặt đúng MỘT role: thu gọn tài khoản nhiều role', async () => {
      const res = await call(
        'PATCH',
        `/users/${ids.adminStaff}/role`,
        'admin',
        {
          role: 'STAFF',
        },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: 'STAFF', roles: ['STAFF'] });
      expect((await dbUser('adminStaff')).roles).toEqual(['STAFF']);
    });

    it('ADMIN cuối cùng (chỉ còn role ADMIN trong tập) không được bỏ ADMIN: 409 LAST_ADMIN_REQUIRED', async () => {
      await userModel.updateMany(
        { _id: { $ne: ids.admin }, roles: UserRole.ADMIN },
        { $set: { status: UserStatus.BLOCKED } },
      );
      const res = await call('PATCH', `/users/${ids.admin}/roles`, 'admin', {
        roles: ['EDITOR'],
      });
      expect([res.status, res.body.errorCode]).toEqual([
        409,
        'LAST_ADMIN_REQUIRED',
      ]);
      expect((await dbUser('admin')).roles).toEqual(['ADMIN']);
    });
  });
});
