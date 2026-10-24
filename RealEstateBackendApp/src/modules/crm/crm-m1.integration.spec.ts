/**
 * INTEGRATION — CRM M1 (người dùng, nhóm, danh mục, dự án) qua HTTP thật:
 * Fastify + ValidationPipe + GlobalExceptionFilter + JwtAuthGuard/RolesGuard + CrmFeatureGuard
 * trên MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis/MinIO.
 *
 * Các `it` trong cùng `describe` dùng chung dữ liệu và chạy THEO THỨ TỰ (mỗi bước dựa trên bước trước).
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService, JwtModule } from '@nestjs/jwt';
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
import { ValidationPipe } from '@nestjs/common';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { backfillUserTeamId } from '../users/migrations/backfill-user-team-id';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';

type Res = { status: number; body: any };

describe('CRM M1 — HTTP + MongoDB Replica Set', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let seed: CrmSeedService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    as: string | null,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: as ? { authorization: `Bearer ${tokens[as]}` } : {},
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? safeJson(res.body) : undefined,
    };
  };
  const safeJson = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
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

  const auditActions = async (entityId: string): Promise<string[]> =>
    (
      await connection
        .collection('crm_audit_logs')
        .find({ entityId: new Types.ObjectId(entityId) })
        .sort({ _id: 1 })
        .toArray()
    ).map((row) => row.action as string);

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    // M2: CrmModule kéo theo PiiCryptoService (cần khóa CCCD) và Redis (rate limit/idempotency, tiền tố riêng).
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = 'it-m1-' + Date.now() + ':';
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
    seed = app.get(CrmSeedService);

    // Tạo sẵn collection + index (transaction đa-collection cần collection tồn tại, unique cần index).
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await seed.seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('manager2', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('blockedStaff', UserRole.STAFF, {
      status: UserStatus.BLOCKED,
    });
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // -------------------------------------------------------------------------
  describe('Cổng tính năng + ma trận phân quyền', () => {
    const READ_ALL = ['admin', 'manager1', 'staffA'];
    const rows: Array<
      [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, string[]]
    > = [
      ['GET', 'GET', '/crm/projects', READ_ALL],
      ['GET', 'GET', '/crm/customer-statuses', READ_ALL],
      ['GET', 'GET', '/crm/lead-sources', READ_ALL],
      ['GET', 'GET', '/crm/contact-results', READ_ALL],
      ['GET', 'GET', '/crm/areas', READ_ALL],
      ['GET', 'GET', '/crm/assignable-users', READ_ALL],
      ['GET', 'GET', '/teams', ['admin', 'manager1']],
      ['GET', 'GET', '/crm/settings', ['admin', 'manager1']],
      ['POST', 'POST', '/crm/projects', ['admin']],
      ['POST', 'POST', '/crm/project-restorations', ['admin']],
      ['POST', 'POST', '/crm/customer-statuses', ['admin']],
      ['POST', 'POST', '/crm/lead-sources', ['admin']],
      ['POST', 'POST', '/crm/contact-results', ['admin']],
      ['POST', 'POST', '/crm/areas', ['admin']],
      ['POST', 'POST', '/teams', ['admin']],
      ['PATCH', 'PATCH', '/crm/settings', ['admin']],
      ['PATCH', 'PATCH', '/users/not-an-id/team', ['admin']],
      ['DELETE', 'DELETE', '/crm/projects/not-an-id', ['admin']],
    ];
    const everyone = ['editor', 'staffA', 'manager1', 'admin'];

    it.each(rows)(
      '%s %s %s: vai trò không thuộc danh sách cho phép nhận 403 (EDITOR luôn bị chặn); vai trò được phép không bị chặn',
      async (_label, method, url, allowed) => {
        for (const who of everyone) {
          const res = await call(
            method,
            url,
            who,
            method === 'GET' ? undefined : {},
          );
          if (allowed.includes(who)) {
            expect([401, 403, 404]).not.toContain(res.status);
          } else {
            expect(res.status).toBe(403);
            expect(res.body.errorCode).toBe('INSUFFICIENT_ROLE');
          }
        }
      },
    );

    it('chưa đăng nhập: 401', async () => {
      expect((await call('GET', '/crm/projects', null)).status).toBe(401);
    });

    it('tắt FEATURE_CRM_ENABLED: route CRM và /teams trả 404, nhưng /users cũ vẫn chạy', async () => {
      process.env[FLAG] = 'false';
      try {
        for (const url of [
          '/crm/projects',
          '/crm/areas',
          '/teams',
          '/crm/settings',
        ]) {
          const res = await call('GET', url, 'admin');
          expect(res.status).toBe(404);
        }
        const patchTeam = await call(
          'PATCH',
          `/users/${ids.staffA}/team`,
          'admin',
          {
            teamId: null,
          },
        );
        expect(patchTeam.status).toBe(404);
        const users = await call('GET', '/users', 'admin');
        expect(users.status).toBe(200);
        expect(users.body.meta).toBeDefined();
      } finally {
        process.env[FLAG] = 'true';
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Vai trò mới + migration an toàn', () => {
    it('POST /users nhận role MANAGER/STAFF kèm teamId; GET /users lọc theo role/status/q', async () => {
      const team = await call('POST', '/teams', 'admin', {
        name: 'Nhóm tạm',
        code: 'tmp',
      });
      expect(team.status).toBe(201);

      const created = await call('POST', '/users', 'admin', {
        email: 'newstaff@test.vn',
        password: 'Staff@123456',
        displayName: 'Nhân viên mới',
        role: 'STAFF',
        teamId: team.body.data.id,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        role: 'STAFF',
        teamId: team.body.data.id,
      });
      expect(created.body.password).toBeUndefined();

      const list = await call('GET', '/users?role=STAFF&q=mới', 'admin');
      expect(list.body.data.map((u: any) => u.email)).toContain(
        'newstaff@test.vn',
      );
      expect(list.body.data.every((u: any) => u.role === 'STAFF')).toBe(true);

      const editorWithTeam = await call('POST', '/users', 'admin', {
        email: 'ed2@test.vn',
        password: 'Editor@123456',
        displayName: 'Editor 2',
        role: 'EDITOR',
        teamId: team.body.data.id,
      });
      expect(editorWithTeam.status).toBe(400);
      expect(editorWithTeam.body.errorCode).toBe('VALIDATION_FAILED');

      // dọn để không ảnh hưởng các test nhóm phía sau
      await userModel.deleteOne({ email: 'newstaff@test.vn' });
      expect(
        (await call('DELETE', `/teams/${team.body.data.id}`, 'admin')).status,
      ).toBe(204);
    });

    it('migration: tài khoản cũ (ADMIN/EDITOR, chưa có teamId) giữ nguyên role, được bổ sung teamId=null; dry-run không ghi; chạy lại là no-op', async () => {
      const users = connection.collection('users');
      await users.insertMany([
        {
          email: 'legacy-admin@test.vn',
          role: 'ADMIN',
          status: 'ACTIVE',
          deletedAt: null,
        },
        {
          email: 'legacy-editor@test.vn',
          role: 'EDITOR',
          status: 'ACTIVE',
          deletedAt: null,
        },
      ]);
      const db = connection.db!;

      const dry = await backfillUserTeamId(db, false);
      expect(dry).toMatchObject({ missingBefore: 2, updated: 0 });
      expect(await users.countDocuments({ teamId: { $exists: false } })).toBe(
        2,
      );

      const applied = await backfillUserTeamId(db, true);
      expect(applied.updated).toBe(2);
      const legacy = await users
        .find({
          email: { $in: ['legacy-admin@test.vn', 'legacy-editor@test.vn'] },
        })
        .sort({ email: 1 })
        .toArray();
      expect(legacy.map((u) => [u.role, u.teamId])).toEqual([
        ['ADMIN', null],
        ['EDITOR', null],
      ]);

      expect(await backfillUserTeamId(db, true)).toMatchObject({
        missingBefore: 0,
        updated: 0,
      });
      const indexKeys = (await users.indexes()).map((index) =>
        JSON.stringify(index.key),
      );
      expect(indexKeys).toContain(JSON.stringify({ teamId: 1, status: 1 }));

      await users.deleteMany({ email: /^legacy-/ });
    });
  });

  // -------------------------------------------------------------------------
  describe('Nhóm (teams) + assignable-users', () => {
    it('tạo nhóm: mã lưu HOA, trả quản lý + memberCount; trùng mã (khác hoa thường) 409; quản lý phải là MANAGER', async () => {
      const kd1 = await call('POST', '/teams', 'admin', {
        name: 'Nhóm Kinh doanh 1',
        code: 'kd1',
        managerIds: [ids.manager1],
      });
      expect(kd1.status).toBe(201);
      expect(kd1.body.data).toMatchObject({
        code: 'KD1',
        isActive: true,
        memberCount: 0,
        managers: [{ id: ids.manager1, displayName: 'manager1' }],
      });
      ids.kd1 = kd1.body.data.id;

      const dup = await call('POST', '/teams', 'admin', {
        name: 'Khác',
        code: 'Kd1',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe('TEAM_CODE_DUPLICATED');

      const staffAsManager = await call('POST', '/teams', 'admin', {
        name: 'Sai',
        code: 'BAD',
        managerIds: [ids.staffA],
      });
      expect(staffAsManager.status).toBe(400);
      expect(staffAsManager.body.details.userIds).toEqual([ids.staffA]);

      const kd2 = await call('POST', '/teams', 'admin', {
        name: 'Nhóm Kinh doanh 2',
        code: 'KD2',
        managerIds: [ids.manager2],
      });
      ids.kd2 = kd2.body.data.id;
      expect(await auditActions(ids.kd1)).toEqual(['TEAM_CREATED']);
    });

    it('gán nhóm cho người dùng: chỉ MANAGER/STAFF, nhóm phải tồn tại; ghi audit USER_TEAM_CHANGED', async () => {
      for (const [user, team] of [
        ['staffA', 'kd1'],
        ['staffB', 'kd1'],
        ['staffC', 'kd2'],
      ]) {
        const res = await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
          teamId: ids[team],
        });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
          _id: ids[user],
          teamId: ids[team],
        });
        expect(res.body.data.password).toBeUndefined();
      }
      expect(await auditActions(ids.staffA)).toEqual(['USER_TEAM_CHANGED']);

      const editor = await call('PATCH', `/users/${ids.editor}/team`, 'admin', {
        teamId: ids.kd1,
      });
      expect(editor.status).toBe(400);

      const missing = await call(
        'PATCH',
        `/users/${ids.staffA}/team`,
        'admin',
        {
          teamId: String(new Types.ObjectId()),
        },
      );
      expect(missing.status).toBe(404);

      const badBody = await call(
        'PATCH',
        `/users/${ids.staffA}/team`,
        'admin',
        {},
      );
      expect(badBody.status).toBe(400);
    });

    it('GET /teams: Quản trị thấy tất cả, Quản lý chỉ nhóm mình, memberCount đúng', async () => {
      const admin = await call('GET', '/teams?q=Kinh doanh', 'admin');
      expect(admin.body.data.map((t: any) => t.code)).toEqual(['KD1', 'KD2']);
      expect(admin.body.data[0].memberCount).toBe(2);
      expect(admin.body.meta).toMatchObject({ total: 2, page: 1, limit: 20 });

      const manager = await call('GET', '/teams', 'manager1');
      expect(manager.body.data.map((t: any) => t.code)).toEqual(['KD1']);
    });

    it('assignable-users: phạm vi theo vai trò, loại người bị khóa/ADMIN/EDITOR, ép teamId trong phạm vi', async () => {
      const names = (res: Res) =>
        res.body.data.map((u: any) => u.displayName).sort();

      const admin = await call('GET', '/crm/assignable-users', 'admin');
      expect(names(admin)).toEqual(
        ['manager1', 'manager2', 'staffA', 'staffB', 'staffC'].sort(),
      );
      expect(admin.body.meta.limit).toBe(100);

      const manager = await call('GET', '/crm/assignable-users', 'manager1');
      expect(names(manager)).toEqual(['staffA', 'staffB']);
      expect(manager.body.data[0].team).toEqual({
        id: ids.kd1,
        label: 'Nhóm Kinh doanh 1',
      });

      const staff = await call('GET', '/crm/assignable-users', 'staffC');
      expect(names(staff)).toEqual(['staffC']);

      // Lọc teamId ngoài phạm vi (dò nhóm khác) => rỗng, không lộ.
      const outside = await call(
        'GET',
        `/crm/assignable-users?teamId=${ids.kd2}`,
        'manager1',
      );
      expect(outside.body.data).toEqual([]);
      const adminFiltered = await call(
        'GET',
        `/crm/assignable-users?teamId=${ids.kd2}`,
        'admin',
      );
      expect(names(adminFiltered)).toEqual(['staffC']);

      // Nhân viên chưa thuộc nhóm nào không thấy ai.
      await createUser('loner', UserRole.STAFF);
      expect(
        (await call('GET', '/crm/assignable-users', 'loner')).body.data,
      ).toEqual([]);
    });

    it('hạ vai trò Quản lý: bị gỡ khỏi managerIds (cùng transaction); chuyển sang ADMIN còn xóa teamId; Quản lý mất quyền xem nhóm cũ', async () => {
      await call('PATCH', `/users/${ids.manager2}/team`, 'admin', {
        teamId: ids.kd2,
      });
      const demote = await call(
        'PATCH',
        `/users/${ids.manager2}/role`,
        'admin',
        {
          role: 'STAFF',
        },
      );
      expect(demote.status).toBe(200);
      const team = await connection
        .collection('teams')
        .findOne({ _id: new Types.ObjectId(ids.kd2) });
      expect(team!.managerIds).toEqual([]);

      // Token cũ vẫn mang role MANAGER nhưng quyền xem nhóm đọc từ DB: không còn nhóm nào.
      const stale = await call('GET', '/teams', 'manager2');
      expect(stale.status).toBe(200);
      expect(stale.body.data.map((t: any) => t.code)).toEqual(['KD2']); // chỉ vì vẫn thuộc nhóm, không phải quản lý

      await call('PATCH', `/users/${ids.manager2}/role`, 'admin', {
        role: 'ADMIN',
      });
      const after = await userModel.findById(ids.manager2).lean();
      expect(after!.teamId).toBeNull();
      await call('PATCH', `/users/${ids.manager2}/role`, 'admin', {
        role: 'MANAGER',
      });
    });

    it('xóa nhóm: còn thành viên => 409 TEAM_NOT_EMPTY { memberCount }; hết thành viên => 204, ẩn khỏi danh sách, ghi audit', async () => {
      const blocked = await call('DELETE', `/teams/${ids.kd1}`, 'admin');
      expect(blocked.status).toBe(409);
      expect(blocked.body.errorCode).toBe('TEAM_NOT_EMPTY');
      expect(blocked.body.details).toEqual({ memberCount: 2 });

      for (const user of ['staffA', 'staffB']) {
        await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
          teamId: null,
        });
      }
      expect((await call('DELETE', `/teams/${ids.kd1}`, 'admin')).status).toBe(
        204,
      );
      expect((await call('DELETE', `/teams/${ids.kd1}`, 'admin')).status).toBe(
        404,
      );
      const list = await call('GET', '/teams?q=KD1', 'admin');
      expect(list.body.data).toEqual([]);
      expect(await auditActions(ids.kd1)).toEqual([
        'TEAM_CREATED',
        'TEAM_DELETED',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('Dự án', () => {
    const base = {
      name: 'Dự án Thử',
      code: 'Thu-01',
      developer: 'Chủ đầu tư X',
    };

    it('thêm dự án: mã giữ chữ người nhập, trạng thái mặc định UPCOMING, propertyTypes luôn là mảng, ghi audit', async () => {
      const res = await call('POST', '/crm/projects', 'admin', {
        ...base,
        propertyTypes: ['Căn hộ', 'can ho', ' Shophouse '],
        priceFrom: 1_000_000_000,
        priceTo: 2_000_000_000,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'Dự án Thử',
        code: 'Thu-01',
        status: 'UPCOMING',
        isActive: true,
        customerCount: 0,
        propertyTypes: ['Căn hộ', 'Shophouse'],
        area: null,
      });
      ids.project = res.body.data.id;

      const minimal = await call('POST', '/crm/projects', 'admin', {
        name: 'Tối giản',
        code: 'MIN',
      });
      expect(minimal.body.data.propertyTypes).toEqual([]);
      ids.minProject = minimal.body.data.id;

      expect(await auditActions(ids.project)).toEqual(['PROJECT_CREATED']);
    });

    it('mã trùng không phân biệt hoa thường => 409 PROJECT_CODE_DUPLICATED và không để lại audit của lần thất bại', async () => {
      const before = await connection
        .collection('crm_audit_logs')
        .countDocuments({});
      const res = await call('POST', '/crm/projects', 'admin', {
        name: 'Trùng',
        code: 'THU-01',
      });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PROJECT_CODE_DUPLICATED');
      expect(res.body.details).toEqual({ code: 'THU-01' });
      expect(
        await connection.collection('crm_audit_logs').countDocuments({}),
      ).toBe(before);
    });

    it('validate: mã sai định dạng, giá đảo ngược, khu vực không tồn tại, status lạ, field thừa', async () => {
      const cases: Array<[Record<string, unknown>, number, string]> = [
        [{ name: 'A', code: 'co dau cach' }, 400, 'VALIDATION_FAILED'],
        [{ name: 'A', code: 'x'.repeat(21) }, 400, 'VALIDATION_FAILED'],
        [{ name: 'A' }, 400, 'VALIDATION_FAILED'],
        [
          { name: 'A', code: 'OK1', priceFrom: 10, priceTo: 5 },
          400,
          'VALIDATION_FAILED',
        ],
        [{ name: 'A', code: 'OK2', priceFrom: -1 }, 400, 'VALIDATION_FAILED'],
        [{ name: 'A', code: 'OK3', status: 'DONE' }, 400, 'VALIDATION_FAILED'],
        [
          { name: 'A', code: 'OK4', customerCode: 'x' },
          400,
          'VALIDATION_FAILED',
        ],
        [
          { name: 'A', code: 'OK5', areaId: String(new Types.ObjectId()) },
          404,
          'RESOURCE_NOT_FOUND',
        ],
      ];
      for (const [body, status, errorCode] of cases) {
        const res = await call('POST', '/crm/projects', 'admin', body);
        expect([res.status, res.body.errorCode]).toEqual([status, errorCode]);
      }
    });

    it('sửa dự án: PATCH một phần, kiểm giá theo giá trị hiện có, null xóa field không bắt buộc, đổi mã vẫn kiểm trùng', async () => {
      const ok = await call('PATCH', `/crm/projects/${ids.project}`, 'admin', {
        status: 'SELLING',
        description: 'Mô tả',
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        status: 'SELLING',
        description: 'Mô tả',
        code: 'Thu-01',
      });

      // priceTo mới thấp hơn priceFrom đang lưu (1 tỷ)
      const bad = await call('PATCH', `/crm/projects/${ids.project}`, 'admin', {
        priceTo: 500,
      });
      expect(bad.status).toBe(400);

      const cleared = await call(
        'PATCH',
        `/crm/projects/${ids.project}`,
        'admin',
        {
          priceFrom: null,
          developer: '',
        },
      );
      expect(cleared.body.data).toMatchObject({
        priceFrom: null,
        developer: null,
        priceTo: 2_000_000_000,
      });

      const nullName = await call(
        'PATCH',
        `/crm/projects/${ids.project}`,
        'admin',
        { name: null },
      );
      expect(nullName.status).toBe(400);

      const dupCode = await call(
        'PATCH',
        `/crm/projects/${ids.project}`,
        'admin',
        { code: 'min' },
      );
      expect(dupCode.status).toBe(409);
      expect(dupCode.body.errorCode).toBe('PROJECT_CODE_DUPLICATED');

      // Đổi mã của chính nó sang cách viết hoa khác là hợp lệ.
      const sameCode = await call(
        'PATCH',
        `/crm/projects/${ids.project}`,
        'admin',
        { code: 'THU-01' },
      );
      expect(sameCode.status).toBe(200);
      expect(sameCode.body.data.code).toBe('THU-01');
    });

    it('danh sách: lọc/sort/phân trang { data, meta }, sort ngoài whitelist 400, isDeleted chỉ Quản trị', async () => {
      const list = await call(
        'GET',
        '/crm/projects?q=thu-01&status=SELLING',
        'staffA',
      );
      expect(list.status).toBe(200);
      expect(list.body.data.map((p: any) => p.code)).toEqual(['THU-01']);
      expect(list.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      });

      const page = await call(
        'GET',
        '/crm/projects?limit=3&page=2&sort=-createdAt',
        'manager1',
      );
      expect(page.body.data).toHaveLength(3);
      expect(page.body.meta).toMatchObject({ page: 2, limit: 3 });

      const badSort = await call(
        'GET',
        '/crm/projects?sort=priceFrom',
        'admin',
      );
      expect(badSort.status).toBe(400);
      expect(badSort.body.errorCode).toBe('INVALID_SORT_FIELD');
      expect(badSort.body.details.allowed).toEqual(['name', 'createdAt']);

      const forbidden = await call(
        'GET',
        '/crm/projects?isDeleted=true',
        'staffA',
      );
      expect(forbidden.status).toBe(403);
      expect(
        (await call('GET', '/crm/projects?isActive=banana', 'admin')).status,
      ).toBe(400);
    });

    it('seed: dự án mẫu có khu vực dạng cây và chi tiết khớp contract', async () => {
      const list = await call('GET', '/crm/projects?q=qterra', 'admin');
      expect(list.body.data[0]).toMatchObject({
        code: 'QTERRA',
        name: "Q'Terra",
        status: 'SELLING',
        propertyTypes: ['Căn hộ'],
        area: { label: 'TP. Thủ Đức' },
      });
      const detail = await call(
        'GET',
        `/crm/projects/${list.body.data[0].id}`,
        'staffA',
      );
      expect(detail.body.data.description).toContain("Q'Terra");
    });

    it('xóa dự án còn khách => 409 PROJECT_IN_USE { customerCount }; chỉ khách CHƯA xóa mềm được tính; ngừng hoạt động qua PATCH', async () => {
      const customers = connection.collection('customers');
      const projectId = new Types.ObjectId(ids.project);
      await customers.insertMany([
        {
          fullName: 'Khách 1',
          phone: '+84900000001',
          interestedProjectIds: [projectId],
          deletedAt: null,
        },
        {
          fullName: 'Khách 2',
          phone: '+84900000002',
          interestedProjectIds: [projectId, new Types.ObjectId()],
          deletedAt: null,
        },
        {
          fullName: 'Khách đã xóa',
          phone: '+84900000003',
          interestedProjectIds: [projectId],
          deletedAt: new Date(),
        },
      ]);

      const list = await call('GET', '/crm/projects?q=thu-01', 'admin');
      expect(list.body.data[0].customerCount).toBe(2);

      const del = await call('DELETE', `/crm/projects/${ids.project}`, 'admin');
      expect(del.status).toBe(409);
      expect(del.body.errorCode).toBe('PROJECT_IN_USE');
      expect(del.body.details).toEqual({ customerCount: 2 });

      const off = await call('PATCH', `/crm/projects/${ids.project}`, 'admin', {
        isActive: false,
      });
      expect(off.body.data.isActive).toBe(false);
      expect(await auditActions(ids.project)).toContain('PROJECT_DEACTIVATED');
      // Khách vẫn giữ liên kết, dự án ngừng vẫn đọc được.
      const detail = await call(
        'GET',
        `/crm/projects/${ids.project}`,
        'staffA',
      );
      expect(detail.body.data).toMatchObject({
        isActive: false,
        customerCount: 2,
      });
      const onlyActive = await call(
        'GET',
        '/crm/projects?q=thu-01&isActive=true',
        'staffA',
      );
      expect(onlyActive.body.data).toEqual([]);
    });

    it('xóa mềm khi không còn khách: 204, biến mất khỏi danh sách thường, Quản trị xem được bằng isDeleted, mã KHÔNG được tái dùng', async () => {
      const del = await call(
        'DELETE',
        `/crm/projects/${ids.minProject}`,
        'admin',
      );
      expect(del.status).toBe(204);

      expect(
        (await call('GET', '/crm/projects?q=MIN', 'admin')).body.data,
      ).toEqual([]);
      const deleted = await call(
        'GET',
        '/crm/projects?isDeleted=true',
        'admin',
      );
      expect(deleted.body.data.map((p: any) => p.code)).toEqual(['MIN']);
      expect(deleted.body.data[0].deletedAt).toEqual(expect.any(String));

      expect(
        (await call('GET', `/crm/projects/${ids.minProject}`, 'staffA')).status,
      ).toBe(404);
      expect(
        (await call('GET', `/crm/projects/${ids.minProject}`, 'admin')).status,
      ).toBe(200);
      expect(
        (
          await call('PATCH', `/crm/projects/${ids.minProject}`, 'admin', {
            name: 'x',
          })
        ).status,
      ).toBe(404);
      expect(
        (await call('DELETE', `/crm/projects/${ids.minProject}`, 'admin'))
          .status,
      ).toBe(404);

      const reuse = await call('POST', '/crm/projects', 'admin', {
        name: 'Dùng lại',
        code: 'min',
      });
      expect(reuse.status).toBe(409);
      expect(reuse.body.errorCode).toBe('PROJECT_CODE_DUPLICATED');
    });

    it('khôi phục: 201 và hiển thị lại; dự án chưa xóa hoặc không tồn tại => 404 RESOURCE_NOT_FOUND', async () => {
      const restored = await call(
        'POST',
        '/crm/project-restorations',
        'admin',
        {
          projectId: ids.minProject,
          reason: 'Xóa nhầm',
        },
      );
      expect(restored.status).toBe(201);
      expect(restored.body.data).toMatchObject({
        code: 'MIN',
        deletedAt: null,
      });
      expect(
        (await call('GET', '/crm/projects?q=MIN', 'staffA')).body.data,
      ).toHaveLength(1);

      const again = await call('POST', '/crm/project-restorations', 'admin', {
        projectId: ids.minProject,
      });
      expect(again.status).toBe(404);
      expect(again.body.errorCode).toBe('RESOURCE_NOT_FOUND');
      const unknown = await call('POST', '/crm/project-restorations', 'admin', {
        projectId: String(new Types.ObjectId()),
      });
      expect(unknown.status).toBe(404);

      const logs = await connection
        .collection('crm_audit_logs')
        .find({ entityId: new Types.ObjectId(ids.minProject) })
        .sort({ _id: 1 })
        .toArray();
      expect(logs.map((l) => l.action)).toEqual([
        'PROJECT_CREATED',
        'PROJECT_DELETED',
        'PROJECT_RESTORED',
      ]);
      expect(logs[2].reason).toBe('Xóa nhầm');
      expect(logs[2].actorName).toBe('admin');
      expect(logs[2].actorRole).toBe('ADMIN');
    });

    it('race: hai request tạo cùng mã (khác hoa thường) cùng lúc => đúng một 201, một 409 (unique index), chỉ một audit', async () => {
      const results = await Promise.all(
        ['Race-1', 'RACE-1', 'race-1', 'rAcE-1'].map((code) =>
          call('POST', '/crm/projects', 'admin', {
            name: `Race ${code}`,
            code,
          }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(3);
      expect(
        await connection
          .collection('projects')
          .countDocuments({ codeNormalized: 'RACE-1' }),
      ).toBe(1);
      const winner = results.find((r) => r.status === 201)!;
      expect(await auditActions(winner.body.data.id)).toEqual([
        'PROJECT_CREATED',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('Tình trạng khách, nguồn khách, kết quả liên hệ', () => {
    it('seed 4 tình trạng hệ thống, mỗi tình trạng một nhóm, đúng một mặc định', async () => {
      const res = await call('GET', '/crm/customer-statuses', 'staffA');
      expect(
        res.body.data.map((s: any) => [
          s.code,
          s.listGroup,
          s.isSystem,
          s.isDefault,
        ]),
      ).toEqual([
        ['NOT_CONTACTED', 'NOT_CONTACTED', true, true],
        ['INTERESTED', 'INTERESTED', true, false],
        ['NET', 'NET', true, false],
        ['DROPPED', 'DROPPED', true, false],
      ]);
      for (const s of res.body.data) ids[`st_${s.code}`] = s.id;

      const filtered = await call(
        'GET',
        '/crm/customer-statuses?listGroup=NET',
        'staffA',
      );
      expect(filtered.body.data.map((s: any) => s.code)).toEqual(['NET']);
    });

    it('thêm tình trạng: chọn nhóm, mã trùng 409, mã sai định dạng 400; đổi mặc định chỉ còn đúng một', async () => {
      const created = await call('POST', '/crm/customer-statuses', 'admin', {
        code: 'FIRST_CALL',
        label: 'Đã gọi lần đầu',
        listGroup: 'NOT_CONTACTED',
        color: 'brand',
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        isSystem: false,
        isDefault: false,
        order: 5,
      });
      ids.st_FIRST_CALL = created.body.data.id;

      const dup = await call('POST', '/crm/customer-statuses', 'admin', {
        code: 'FIRST_CALL',
        label: 'Trùng',
        listGroup: 'NET',
      });
      expect([dup.status, dup.body.errorCode]).toEqual([
        409,
        'CATALOG_DUPLICATED',
      ]);
      expect(
        (
          await call('POST', '/crm/customer-statuses', 'admin', {
            code: 'lower',
            label: 'x',
            listGroup: 'NET',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('POST', '/crm/customer-statuses', 'admin', {
            code: 'CARING',
            label: 'x',
            listGroup: 'CARING',
          })
        ).status,
      ).toBe(400);

      const flip = await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_FIRST_CALL}`,
        'admin',
        {
          isDefault: true,
        },
      );
      expect(flip.status).toBe(200);
      const list = await call('GET', '/crm/customer-statuses', 'admin');
      expect(
        list.body.data.filter((s: any) => s.isDefault).map((s: any) => s.code),
      ).toEqual(['FIRST_CALL']);

      // Không thể bỏ cờ mặc định mà không chỉ định người thay; trả lại mặc định ban đầu bằng cách đặt cờ cho nó.
      const unset = await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_FIRST_CALL}`,
        'admin',
        { isDefault: false },
      );
      expect(unset.status).toBe(400);
      await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_NOT_CONTACTED}`,
        'admin',
        { isDefault: true },
      );
      const after = await call('GET', '/crm/customer-statuses', 'admin');
      expect(
        after.body.data.filter((s: any) => s.isDefault).map((s: any) => s.code),
      ).toEqual(['NOT_CONTACTED']);
    });

    it('bất biến: mặc định phải ở NOT_CONTACTED; tình trạng hệ thống không đổi nhóm, không xóa', async () => {
      const wrongGroup = await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_INTERESTED}`,
        'admin',
        { isDefault: true },
      );
      expect(wrongGroup.status).toBe(400);

      const moveSystem = await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_NET}`,
        'admin',
        { listGroup: 'DROPPED' },
      );
      expect([moveSystem.status, moveSystem.body.errorCode]).toEqual([
        409,
        'CATALOG_SYSTEM',
      ]);

      const delSystem = await call(
        'DELETE',
        `/crm/customer-statuses/${ids.st_NET}`,
        'admin',
      );
      expect([delSystem.status, delSystem.body.errorCode]).toEqual([
        409,
        'CATALOG_SYSTEM',
      ]);

      const renamed = await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_NET}`,
        'admin',
        { label: 'Khách NET' },
      );
      expect(renamed.body.data.label).toBe('Khách NET');
      const deactivated = await call(
        'PATCH',
        `/crm/customer-statuses/${ids.st_NET}`,
        'admin',
        { isActive: false },
      );
      expect(deactivated.body.data.isActive).toBe(false);
      const activeOnly = await call(
        'GET',
        '/crm/customer-statuses?isActive=true',
        'admin',
      );
      expect(activeOnly.body.data.map((s: any) => s.code)).not.toContain('NET');
      await call('PATCH', `/crm/customer-statuses/${ids.st_NET}`, 'admin', {
        isActive: true,
        label: 'Khách net',
      });
    });

    it('xóa tình trạng đang có khách => 409 CATALOG_IN_USE { usageCount }; không còn khách => 204 và ghi audit', async () => {
      await connection.collection('customers').insertOne({
        fullName: 'Khách có tình trạng',
        phone: '+84900000004',
        statusId: new Types.ObjectId(ids.st_FIRST_CALL),
        deletedAt: null,
      });
      const inUse = await call(
        'DELETE',
        `/crm/customer-statuses/${ids.st_FIRST_CALL}`,
        'admin',
      );
      expect([inUse.status, inUse.body.errorCode]).toEqual([
        409,
        'CATALOG_IN_USE',
      ]);
      expect(inUse.body.details).toEqual({ usageCount: 1 });

      await connection
        .collection('customers')
        .deleteMany({ fullName: 'Khách có tình trạng' });
      expect(
        (
          await call(
            'DELETE',
            `/crm/customer-statuses/${ids.st_FIRST_CALL}`,
            'admin',
          )
        ).status,
      ).toBe(204);
      expect(
        (await call('GET', '/crm/customer-statuses', 'admin')).body.data.map(
          (s: any) => s.code,
        ),
      ).not.toContain('FIRST_CALL');
      const log = await connection.collection('crm_audit_logs').findOne({
        entityId: new Types.ObjectId(ids.st_FIRST_CALL),
        action: 'CATALOG_DELETED',
      });
      expect(log).toMatchObject({
        entityType: 'CATALOG',
        entitySubtype: 'CUSTOMER_STATUS',
      });
    });

    it('nguồn khách: seed sẵn, thêm/sửa/xóa mềm, trùng mã 409, đang có khách thì không xóa được', async () => {
      const seeded = await call('GET', '/crm/lead-sources', 'staffA');
      expect(seeded.body.data.map((s: any) => s.code)).toEqual([
        'WEBSITE',
        'FACEBOOK_ADS',
        'GOOGLE_ADS',
        'REFERRAL',
        'TELESALES',
        'EVENT',
      ]);
      expect(seeded.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: 'Website STND',
          order: 1,
          isActive: true,
        }),
      );

      const created = await call('POST', '/crm/lead-sources', 'admin', {
        code: 'ZALO_OA',
        label: 'Zalo OA',
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        code: 'ZALO_OA',
        order: 7,
        isActive: true,
      });
      ids.zalo = created.body.data.id;

      const dup = await call('POST', '/crm/lead-sources', 'admin', {
        code: 'ZALO_OA',
        label: 'Trùng',
      });
      expect([dup.status, dup.body.errorCode]).toEqual([
        409,
        'CATALOG_DUPLICATED',
      ]);
      // `code` bất biến: không nhận trong PATCH (whitelist chặn).
      expect(
        (
          await call('PATCH', `/crm/lead-sources/${ids.zalo}`, 'admin', {
            code: 'KHAC',
          })
        ).status,
      ).toBe(400);
      const patched = await call(
        'PATCH',
        `/crm/lead-sources/${ids.zalo}`,
        'admin',
        { label: 'Zalo', isActive: false },
      );
      expect(patched.body.data).toMatchObject({
        label: 'Zalo',
        isActive: false,
      });

      await connection.collection('customers').insertOne({
        fullName: 'Khách nguồn',
        phone: '+84900000005',
        sourceId: new Types.ObjectId(ids.zalo),
        deletedAt: null,
      });
      const inUse = await call(
        'DELETE',
        `/crm/lead-sources/${ids.zalo}`,
        'admin',
      );
      expect([inUse.status, inUse.body.errorCode]).toEqual([
        409,
        'CATALOG_IN_USE',
      ]);
      await connection
        .collection('customers')
        .deleteMany({ fullName: 'Khách nguồn' });
      expect(
        (await call('DELETE', `/crm/lead-sources/${ids.zalo}`, 'admin')).status,
      ).toBe(204);
      const search = await call('GET', '/crm/lead-sources?q=zalo', 'admin');
      expect(search.body.data).toEqual([]);
    });

    it('kết quả liên hệ: gợi ý mốc hẹn lưu/sửa riêng từng field, seed có mục không gợi ý (null)', async () => {
      const list = await call('GET', '/crm/contact-results', 'staffA');
      const declined = list.body.data.find((r: any) => r.code === 'DECLINED');
      expect(declined).toMatchObject({
        suggestedFollowUpDays: null,
        suggestionText: '',
      });

      const created = await call('POST', '/crm/contact-results', 'admin', {
        code: 'SENT_BROCHURE',
        label: 'Đã gửi tài liệu',
        suggestedFollowUpDays: 3,
        suggestionText: 'Gọi hỏi phản hồi',
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        suggestedFollowUpDays: 3,
        suggestionText: 'Gọi hỏi phản hồi',
      });

      const patched = await call(
        'PATCH',
        `/crm/contact-results/${created.body.data.id}`,
        'admin',
        {
          suggestedFollowUpDays: null,
        },
      );
      expect(patched.body.data).toMatchObject({
        suggestedFollowUpDays: null,
        suggestionText: 'Gọi hỏi phản hồi',
      });
      expect(
        (
          await call('POST', '/crm/contact-results', 'admin', {
            code: 'X',
            label: 'x',
            suggestedFollowUpDays: 9999,
          })
        ).status,
      ).toBe(400);

      await connection.collection('care_logs').insertOne({
        contactResultId: new Types.ObjectId(created.body.data.id),
        deletedAt: null,
      });
      expect(
        (
          await call(
            'DELETE',
            `/crm/contact-results/${created.body.data.id}`,
            'admin',
          )
        ).status,
      ).toBe(409);
      await connection.collection('care_logs').deleteMany({});
      expect(
        (
          await call(
            'DELETE',
            `/crm/contact-results/${created.body.data.id}`,
            'admin',
          )
        ).status,
      ).toBe(204);
    });
  });

  // -------------------------------------------------------------------------
  describe('Khu vực (cây)', () => {
    it('seed: tỉnh/thành là gốc, quận/huyện là con; tìm không dấu; path là tổ tiên', async () => {
      const roots = await call('GET', '/crm/areas?parentId=root', 'staffA');
      expect(roots.body.data.map((a: any) => a.name)).toEqual([
        'TP. Hồ Chí Minh',
        'Hà Nội',
        'Hưng Yên',
        'Bình Dương',
        'Nước ngoài',
      ]);
      ids.hcm = roots.body.data[0].id;
      ids.hanoi = roots.body.data[1].id;

      const found = await call('GET', '/crm/areas?q=thu duc', 'staffA');
      expect(found.body.data).toHaveLength(1);
      expect(found.body.data[0]).toMatchObject({
        name: 'TP. Thủ Đức',
        label: 'TP. Thủ Đức',
        type: 'DISTRICT',
        parentId: ids.hcm,
        path: [{ id: ids.hcm, label: 'TP. Hồ Chí Minh' }],
      });
      ids.thuDuc = found.body.data[0].id;

      const children = await call(
        'GET',
        `/crm/areas?parentId=${ids.hcm}`,
        'staffA',
      );
      expect(children.body.data).toHaveLength(5);
      expect(
        (await call('GET', '/crm/areas?parentId=abc', 'staffA')).status,
      ).toBe(400);
    });

    it('thêm khu vực con, trùng tên (không dấu, không phân biệt hoa thường) dưới cùng cha 409, cha không tồn tại 404', async () => {
      const province = await call('POST', '/crm/areas', 'admin', {
        name: 'Tỉnh Thử',
        type: 'PROVINCE',
      });
      expect(province.status).toBe(201);
      ids.tProvince = province.body.data.id;
      const district = await call('POST', '/crm/areas', 'admin', {
        name: 'Huyện Thử',
        type: 'DISTRICT',
        parentId: ids.tProvince,
      });
      ids.tDistrict = district.body.data.id;
      const ward = await call('POST', '/crm/areas', 'admin', {
        name: 'Xã Thử',
        type: 'WARD',
        parentId: ids.tDistrict,
      });
      ids.tWard = ward.body.data.id;
      expect(ward.body.data.path.map((p: any) => p.label)).toEqual([
        'Tỉnh Thử',
        'Huyện Thử',
      ]);

      const dup = await call('POST', '/crm/areas', 'admin', {
        name: 'huyen thu',
        type: 'DISTRICT',
        parentId: ids.tProvince,
      });
      expect([dup.status, dup.body.errorCode]).toEqual([
        409,
        'CATALOG_DUPLICATED',
      ]);
      // Cùng tên nhưng khác cha thì được.
      expect(
        (
          await call('POST', '/crm/areas', 'admin', {
            name: 'Huyện Thử',
            type: 'DISTRICT',
            parentId: ids.hcm,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await call('POST', '/crm/areas', 'admin', {
            name: 'Mồ côi',
            type: 'WARD',
            parentId: String(new Types.ObjectId()),
          })
        ).status,
      ).toBe(404);
    });

    it('chuyển khu vực sang cha mới: tổ tiên của cả nhánh con được cập nhật; không cho chuyển vào chính nhánh của nó', async () => {
      const cycle = await call(
        'PATCH',
        `/crm/areas/${ids.tDistrict}`,
        'admin',
        { parentId: ids.tWard },
      );
      expect([cycle.status, cycle.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(
        (
          await call('PATCH', `/crm/areas/${ids.tDistrict}`, 'admin', {
            parentId: ids.tDistrict,
          })
        ).status,
      ).toBe(400);

      const moved = await call(
        'PATCH',
        `/crm/areas/${ids.tDistrict}`,
        'admin',
        { parentId: ids.hanoi },
      );
      expect(moved.status).toBe(200);
      expect(moved.body.data.path).toEqual([
        { id: ids.hanoi, label: 'Hà Nội' },
      ]);

      const wards = await call(
        'GET',
        `/crm/areas?parentId=${ids.tDistrict}`,
        'admin',
      );
      expect(wards.body.data[0].path.map((p: any) => p.label)).toEqual([
        'Hà Nội',
        'Huyện Thử',
      ]);

      // Lọc theo tỉnh gồm cả khu vực con qua ancestorIds.
      const underHanoi = await connection.collection('areas').countDocuments({
        ancestorIds: new Types.ObjectId(ids.hanoi),
        name: 'Xã Thử',
      });
      expect(underHanoi).toBe(1);

      const toRoot = await call(
        'PATCH',
        `/crm/areas/${ids.tDistrict}`,
        'admin',
        { parentId: null },
      );
      expect(toRoot.body.data).toMatchObject({ parentId: null, path: [] });
      const wardAfter = await call(
        'GET',
        `/crm/areas?parentId=${ids.tDistrict}`,
        'admin',
      );
      expect(wardAfter.body.data[0].path.map((p: any) => p.label)).toEqual([
        'Huyện Thử',
      ]);
    });

    it('khu vực cũ (isLegacy) mặc định ẩn, includeLegacy=true mới thấy', async () => {
      await call('PATCH', `/crm/areas/${ids.tWard}`, 'admin', {
        isLegacy: true,
      });
      expect(
        (await call('GET', `/crm/areas?q=xa thu`, 'staffA')).body.data,
      ).toEqual([]);
      const withLegacy = await call(
        'GET',
        '/crm/areas?q=xa thu&includeLegacy=true',
        'staffA',
      );
      expect(withLegacy.body.data.map((a: any) => a.name)).toEqual(['Xã Thử']);
    });

    it('xóa mềm: còn khu vực con hoặc đang dùng (khách/dự án) => 409 CATALOG_IN_USE; hết thì 204', async () => {
      const hasChild = await call(
        'DELETE',
        `/crm/areas/${ids.tDistrict}`,
        'admin',
      );
      expect([hasChild.status, hasChild.body.errorCode]).toEqual([
        409,
        'CATALOG_IN_USE',
      ]);
      expect(hasChild.body.details).toEqual({ usageCount: 0, childCount: 1 });

      const usedByProject = await call(
        'DELETE',
        `/crm/areas/${ids.thuDuc}`,
        'admin',
      );
      expect([usedByProject.status, usedByProject.body.errorCode]).toEqual([
        409,
        'CATALOG_IN_USE',
      ]);
      expect(usedByProject.body.details.usageCount).toBeGreaterThan(0);

      await connection.collection('customers').insertOne({
        fullName: 'Khách khu vực',
        phone: '+84900000006',
        areaId: new Types.ObjectId(ids.tWard),
        deletedAt: null,
      });
      expect(
        (await call('DELETE', `/crm/areas/${ids.tWard}`, 'admin')).body.details
          .usageCount,
      ).toBe(1);
      await connection
        .collection('customers')
        .deleteMany({ fullName: 'Khách khu vực' });

      expect(
        (await call('DELETE', `/crm/areas/${ids.tWard}`, 'admin')).status,
      ).toBe(204);
      expect(
        (await call('DELETE', `/crm/areas/${ids.tDistrict}`, 'admin')).status,
      ).toBe(204);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cài đặt CRM', () => {
    it('GET trả mặc định; PATCH một phần lưu bền, validate, ghi audit SETTINGS_UPDATED; Quản lý đọc được', async () => {
      const initial = await call('GET', '/crm/settings', 'manager1');
      expect(initial.body.data).toMatchObject({
        staleCustomerDays: 14,
        staleCheckTime: '08:00',
        occasionLeadDays: [0, 1],
        defaultAppointmentReminderMinutes: [60, 1440],
        careLogEditWindowHours: 24,
        phoneViewAlertPerHour: 200,
      });

      const patched = await call('PATCH', '/crm/settings', 'admin', {
        staleCustomerDays: 30,
        occasionLeadDays: [0, 2, 7],
      });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({
        staleCustomerDays: 30,
        occasionLeadDays: [0, 2, 7],
        staleCheckTime: '08:00',
      });
      expect(
        (await call('GET', '/crm/settings', 'admin')).body.data
          .staleCustomerDays,
      ).toBe(30);

      for (const bad of [
        { staleCheckTime: '25:00' },
        { staleCustomerDays: 0 },
        { occasionLeadDays: [1, 1] },
        { occasionLeadDays: [] },
        { unknownField: 1 },
      ]) {
        expect(
          (await call('PATCH', '/crm/settings', 'admin', bad)).status,
        ).toBe(400);
      }

      const log = await connection
        .collection('crm_audit_logs')
        .findOne({ action: 'SETTINGS_UPDATED' });
      expect(log!.changes).toEqual([
        { field: 'staleCustomerDays', from: 14, to: 30 },
        { field: 'occasionLeadDays', from: [0, 1], to: [0, 2, 7] },
      ]);
      expect(
        await connection.collection('crm_settings').countDocuments({}),
      ).toBe(1);
      // Field chưa từng sửa không được lưu thành mảng rỗng che mất mặc định.
      const stored = await connection.collection('crm_settings').findOne({});
      expect(stored!.defaultAppointmentReminderMinutes).toBeUndefined();
      expect(
        (await call('GET', '/crm/settings', 'admin')).body.data
          .defaultAppointmentReminderMinutes,
      ).toEqual([60, 1440]);
    });
  });

  // -------------------------------------------------------------------------
  describe('Quản lý tài khoản: audit, chặn ADMIN cuối cùng, quyền đọc từ DB', () => {
    it('đổi role/khóa tài khoản ghi audit USER_ROLE_CHANGED/USER_STATUS_CHANGED; actorName/actorRole lấy từ DB', async () => {
      await createUser('admin2', UserRole.ADMIN);

      const role = await call('PATCH', `/users/${ids.staffB}/role`, 'admin2', {
        role: 'EDITOR',
      });
      expect(role.status).toBe(200);
      const status = await call(
        'PATCH',
        `/users/${ids.staffB}/status`,
        'admin2',
        { status: 'BLOCKED' },
      );
      expect(status.status).toBe(200);

      const logs = await connection
        .collection('crm_audit_logs')
        .find({
          entityId: new Types.ObjectId(ids.staffB),
          action: { $in: ['USER_ROLE_CHANGED', 'USER_STATUS_CHANGED'] },
        })
        .sort({ _id: 1 })
        .toArray();
      expect(logs.map((log) => log.action)).toEqual([
        'USER_ROLE_CHANGED',
        'USER_STATUS_CHANGED',
      ]);
      expect(logs[0].changes).toEqual([
        { field: 'role', from: 'STAFF', to: 'EDITOR' },
      ]);
      expect(logs[1].changes).toEqual([
        { field: 'status', from: 'ACTIVE', to: 'BLOCKED' },
      ]);
      expect(logs[0]).toMatchObject({
        actorName: 'admin2',
        actorRole: 'ADMIN',
      });

      // Đặt lại đúng giá trị hiện có là no-op: không thêm audit.
      await call('PATCH', `/users/${ids.staffB}/status`, 'admin2', {
        status: 'BLOCKED',
      });
      expect(
        await connection.collection('crm_audit_logs').countDocuments({
          entityId: new Types.ObjectId(ids.staffB),
          action: { $in: ['USER_ROLE_CHANGED', 'USER_STATUS_CHANGED'] },
        }),
      ).toBe(2);

      // dọn: trả staffB về STAFF đang hoạt động
      await call('PATCH', `/users/${ids.staffB}/status`, 'admin2', {
        status: 'ACTIVE',
      });
      await call('PATCH', `/users/${ids.staffB}/role`, 'admin2', {
        role: 'STAFF',
      });
    });

    it('không hạ vai trò / khóa ADMIN đang hoạt động cuối cùng (409 LAST_ADMIN_REQUIRED)', async () => {
      // Hạ `admin` (còn admin2) được; sau đó admin2 là ADMIN duy nhất.
      expect(
        (
          await call('PATCH', `/users/${ids.admin}/role`, 'admin2', {
            role: 'STAFF',
          })
        ).status,
      ).toBe(200);

      const demoteSelf = await call(
        'PATCH',
        `/users/${ids.admin2}/role`,
        'admin2',
        { role: 'STAFF' },
      );
      expect([demoteSelf.status, demoteSelf.body.errorCode]).toEqual([
        409,
        'LAST_ADMIN_REQUIRED',
      ]);
      expect((await userModel.findById(ids.admin2).lean())!.role).toBe('ADMIN');

      // `admin` (token cũ còn ghi ADMIN) đã bị hạ trong DB => 403 ngay, không đợi token hết hạn.
      const stale = await call('POST', '/crm/projects', 'admin', {
        name: 'Không được',
        code: 'STALE-ADMIN',
      });
      expect(stale.status).toBe(403);

      // khôi phục
      expect(
        (
          await call('PATCH', `/users/${ids.admin}/role`, 'admin2', {
            role: 'ADMIN',
          })
        ).status,
      ).toBe(200);
    });

    it('hai ADMIN đồng thời hạ vai trò lẫn nhau: luôn còn ít nhất một ADMIN đang hoạt động (không write-skew)', async () => {
      const results = await Promise.all([
        call('PATCH', `/users/${ids.admin2}/role`, 'admin', { role: 'STAFF' }),
        call('PATCH', `/users/${ids.admin}/role`, 'admin2', { role: 'STAFF' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await userModel.countDocuments({
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        }),
      ).toBeGreaterThanOrEqual(1);

      // khôi phục cả hai về ADMIN (người còn ADMIN thực hiện)
      const survivor = results[0].status === 200 ? 'admin' : 'admin2';
      const demoted = survivor === 'admin' ? 'admin2' : 'admin';
      await call('PATCH', `/users/${ids[demoted]}/role`, survivor, {
        role: 'ADMIN',
      });
      expect(
        await userModel.countDocuments({
          role: UserRole.ADMIN,
          deletedAt: null,
        }),
      ).toBeGreaterThanOrEqual(2);
    });

    it('id sai định dạng: 400 (không 500); khóa chính mình vẫn bị chặn', async () => {
      expect(
        (await call('PATCH', '/users/abc/role', 'admin', { role: 'STAFF' }))
          .status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', '/users/abc/status', 'admin', {
            status: 'BLOCKED',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.admin}/status`, 'admin', {
            status: 'BLOCKED',
          })
        ).status,
      ).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cài đặt: upsert đồng thời lần đầu', () => {
    it('hai ADMIN PATCH cùng lúc khi chưa có bản ghi: cả hai thành công (retry khi E11000), chỉ một bản ghi', async () => {
      await connection.collection('crm_settings').deleteMany({});
      const results = await Promise.all([
        call('PATCH', '/crm/settings', 'admin', { staleCustomerDays: 20 }),
        call('PATCH', '/crm/settings', 'admin2', {
          careLogEditWindowHours: 12,
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(
        await connection.collection('crm_settings').countDocuments({}),
      ).toBe(1);
      const stored = (await call('GET', '/crm/settings', 'admin')).body.data;
      expect(stored).toMatchObject({
        staleCustomerDays: 20,
        careLogEditWindowHours: 12,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('Seed idempotent', () => {
    it('chạy lại không chèn thêm gì; không ghi đè chỉnh sửa của Quản trị và không "hồi sinh" bản đã xóa mềm', async () => {
      const counts = async () => ({
        statuses: await connection
          .collection('customer_statuses')
          .countDocuments({}),
        items: await connection.collection('catalog_items').countDocuments({}),
        areas: await connection.collection('areas').countDocuments({}),
        projects: await connection.collection('projects').countDocuments({}),
      });
      const before = await counts();
      expect(await seed.seedAll()).toEqual({
        statuses: 0,
        leadSources: 0,
        contactResults: 0,
        areas: 0,
        projects: 0,
      });
      expect(await counts()).toEqual(before);

      // Quản trị xóa mềm một dự án mẫu và đổi nhãn một tình trạng.
      const priv = await connection
        .collection('projects')
        .findOne({ codeNormalized: 'PRIVIA' });
      const deleted = await call(
        'DELETE',
        `/crm/projects/${String(priv!._id)}`,
        'admin',
      );
      expect(deleted.status).toBe(204);
      await call('PATCH', `/crm/customer-statuses/${ids.st_DROPPED}`, 'admin', {
        label: 'Đã bỏ',
      });

      await seed.seedAll();
      const after = await connection
        .collection('projects')
        .findOne({ codeNormalized: 'PRIVIA' });
      expect(after!.deletedAt).not.toBeNull();
      expect(await counts()).toEqual(before);
      const dropped = await connection
        .collection('customer_statuses')
        .findOne({ code: 'DROPPED' });
      expect(dropped!.label).toBe('Đã bỏ');
    });

    it('dữ liệu seed từ TRƯỚC khi có seedKey: ghép theo khóa cũ, gắn bổ sung seedKey, không tạo trùng', async () => {
      const collections = [
        'customer_statuses',
        'catalog_items',
        'areas',
        'projects',
      ];
      const counts = async () =>
        Promise.all(
          collections.map((name) =>
            connection.collection(name).countDocuments({}),
          ),
        );
      const before = await counts();
      for (const name of collections) {
        await connection
          .collection(name)
          .updateMany({}, { $unset: { seedKey: '' } });
      }

      expect(await seed.seedAll()).toEqual({
        statuses: 0,
        leadSources: 0,
        contactResults: 0,
        areas: 0,
        projects: 0,
      });
      expect(await counts()).toEqual(before);
      // Mọi bản ghi mẫu được gắn lại seedKey (trừ bản không phải seed: tình trạng/mã do test tạo).
      expect(
        await connection
          .collection('customer_statuses')
          .countDocuments({ seedKey: /^STATUS:/ }),
      ).toBe(4);
      expect(
        await connection
          .collection('projects')
          .countDocuments({ seedKey: 'PROJECT:QTERRA' }),
      ).toBe(1);
    });

    it('khởi động khi cờ tắt: không ghi gì vào DB; khi bật thì seed bù phần còn thiếu', async () => {
      await connection.collection('customer_statuses').deleteMany({});
      process.env[FLAG] = 'false';
      await seed.onApplicationBootstrap();
      expect(
        await connection.collection('customer_statuses').countDocuments({}),
      ).toBe(0);

      process.env[FLAG] = 'true';
      await seed.onApplicationBootstrap();
      expect(
        await connection.collection('customer_statuses').countDocuments({}),
      ).toBe(4);
    });
  });
});
