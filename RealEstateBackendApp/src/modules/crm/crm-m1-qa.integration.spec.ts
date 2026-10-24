/**
 * INTEGRATION (QA bổ sung) — CRM M1: các ca đối kháng mà bộ `crm-m1.integration.spec.ts` chưa phủ.
 * Cùng harness: Fastify + ValidationPipe + GlobalExceptionFilter + JwtAuthGuard/RolesGuard thật
 * trên MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis/MinIO.
 *
 * Gồm các ca hồi quy cho lỗi đã xác nhận ở review QA M1 (B1, S1–S6) và các ca bảo mật/ràng buộc
 * mà bộ của coder chưa phủ; tất cả phải xanh.
 */
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
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';

interface Res {
  status: number;
  body: any;
}

describe('CRM M1 — QA đối kháng (HTTP + Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let seed: CrmSeedService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  };

  const createUser = async (
    key: string,
    role: UserRole,
    extra: Record<string, unknown> = {},
  ) => {
    const user = await userModel.create({
      email: `${key}@qa.vn`,
      password: 'hash',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
      ...extra,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

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
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await seed.seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------
  describe('Ma trận ghi đầy đủ: chỉ ADMIN được POST/PATCH/DELETE (id thật, không dừng ở 400/404)', () => {
    let teamId: string;
    let statusId: string;
    let sourceId: string;
    let resultId: string;
    let areaId: string;
    let projectId: string;

    beforeAll(async () => {
      teamId = (
        await call('POST', '/teams', 'admin', { name: 'QA', code: 'QA1' })
      ).body.data.id;
      statusId = (
        await call('POST', '/crm/customer-statuses', 'admin', {
          code: 'QA_ST',
          label: 'QA',
          listGroup: 'NET',
        })
      ).body.data.id;
      sourceId = (
        await call('POST', '/crm/lead-sources', 'admin', {
          code: 'QA_SRC',
          label: 'QA',
        })
      ).body.data.id;
      resultId = (
        await call('POST', '/crm/contact-results', 'admin', {
          code: 'QA_RES',
          label: 'QA',
        })
      ).body.data.id;
      areaId = (
        await call('POST', '/crm/areas', 'admin', {
          name: 'QA Area',
          type: 'OTHER',
        })
      ).body.data.id;
      projectId = (
        await call('POST', '/crm/projects', 'admin', {
          name: 'QA Project',
          code: 'QAP',
        })
      ).body.data.id;
    });

    it.each(['manager1', 'staffA', 'editor'])(
      '%s bị 403 INSUFFICIENT_ROLE ở MỌI route ghi (PATCH/DELETE cả danh mục lẫn nhóm)',
      async (who) => {
        const writes: Array<['POST' | 'PATCH' | 'DELETE', string]> = [
          ['PATCH', `/teams/${teamId}`],
          ['DELETE', `/teams/${teamId}`],
          ['PATCH', `/users/${ids.staffA}/role`],
          ['PATCH', `/users/${ids.staffA}/status`],
          ['PATCH', `/users/${ids.staffA}/team`],
          ['POST', `/users`],
          ['PATCH', `/crm/customer-statuses/${statusId}`],
          ['DELETE', `/crm/customer-statuses/${statusId}`],
          ['PATCH', `/crm/lead-sources/${sourceId}`],
          ['DELETE', `/crm/lead-sources/${sourceId}`],
          ['PATCH', `/crm/contact-results/${resultId}`],
          ['DELETE', `/crm/contact-results/${resultId}`],
          ['PATCH', `/crm/areas/${areaId}`],
          ['DELETE', `/crm/areas/${areaId}`],
          ['PATCH', `/crm/projects/${projectId}`],
          ['DELETE', `/crm/projects/${projectId}`],
        ];
        for (const [method, url] of writes) {
          const res = await call(method, url, who, {});
          expect([method, url, res.status]).toEqual([method, url, 403]);
        }
        // Không có tác dụng phụ: dữ liệu vẫn nguyên.
        expect(
          (await call('GET', `/crm/projects/${projectId}`, 'admin')).status,
        ).toBe(200);
      },
    );

    it('leo thang đặc quyền: STAFF/MANAGER tự đổi role/team của chính mình bị 403, DB không đổi', async () => {
      for (const who of ['staffA', 'manager1']) {
        expect(
          (
            await call('PATCH', `/users/${ids[who]}/role`, who, {
              role: 'ADMIN',
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await call('PATCH', `/users/${ids[who]}/team`, who, {
              teamId,
            })
          ).status,
        ).toBe(403);
      }
      const staff = await userModel.findById(ids.staffA).lean();
      expect(staff?.role).toBe(UserRole.STAFF);
      expect(staff?.teamId ?? null).toBeNull();
    });

    it('EDITOR gọi mọi route đọc CRM => 403 (không thấy cả /teams, /crm/settings)', async () => {
      for (const url of [
        '/crm/projects',
        `/crm/projects/${projectId}`,
        '/crm/areas',
        '/crm/customer-statuses',
        '/crm/lead-sources',
        '/crm/contact-results',
        '/crm/assignable-users',
        '/crm/settings',
        '/teams',
        '/users',
      ]) {
        expect([url, (await call('GET', url, 'editor')).status]).toEqual([
          url,
          403,
        ]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Swagger', () => {
    it('dựng được tài liệu OpenAPI và có đủ 30 route CRM/teams của M1', () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('qa').addBearerAuth().build(),
      );
      const ops = Object.entries(doc.paths).flatMap(([route, item]) =>
        Object.keys(item as object)
          .filter((verb) => ['get', 'post', 'patch', 'delete'].includes(verb))
          .map((verb) => `${verb.toUpperCase()} ${route}`),
      );
      // Route khách hàng lõi thuộc M2 (crm-m2.integration.spec.ts), chăm sóc/hàng loạt thuộc M3
      // (crm-m3.integration.spec.ts), chân dung/thẻ thuộc M4 (crm-m4.integration.spec.ts), lịch hẹn/việc hôm nay thuộc M5
      // (crm-m5.integration.spec.ts): không tính vào bộ đếm M1.
      const isM2Route = (op: string) =>
        /\/crm\/(customers|deleted-customers|customer-restorations|customer-anonymizations|customer-bulk-operations|care-team-requests|audit-logs|persona-fields|tags|appointments|daily-tasks)/.test(
          op,
        );
      const crmOps = ops.filter(
        (op) =>
          (op.includes('/crm/') ||
            op.includes('/teams') ||
            op.includes('/users/{id}/team')) &&
          !isM2Route(op),
      );
      // teams 4 + users/:id/team 1 + assignable-users 1 + settings 2 + danh mục 16 + projects 6 = 30
      expect(crmOps).toHaveLength(30);
      for (const op of [
        'POST /api/v1/crm/project-restorations',
        'PATCH /api/v1/users/{id}/team',
        'DELETE /api/v1/teams/{id}',
      ]) {
        expect(ops).toContain(op);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Injection / id sai ở query và path', () => {
    it('q là chuỗi regex độc hại (ReDoS, ".*") chỉ khớp theo nghĩa đen, trả nhanh', async () => {
      await call('POST', '/crm/projects', 'admin', {
        name: 'Alpha Beta',
        code: 'AB1',
      });
      const started = Date.now();
      for (const q of ['(a+)+$', '.*', '^', '[a-', 'a|b']) {
        const res = await call(
          'GET',
          `/crm/projects?q=${encodeURIComponent(q)}`,
          'admin',
        );
        expect([q, res.status, res.body.data.length]).toEqual([q, 200, 0]);
        for (const url of [
          `/crm/areas?q=${encodeURIComponent(q)}`,
          `/crm/lead-sources?q=${encodeURIComponent(q)}`,
          `/users?q=${encodeURIComponent(q)}`,
          `/teams?q=${encodeURIComponent(q)}`,
          `/crm/assignable-users?q=${encodeURIComponent(q)}`,
        ]) {
          const other = await call('GET', url, 'admin');
          expect([url, other.status, other.body.data.length]).toEqual([
            url,
            200,
            0,
          ]);
        }
      }
      expect(Date.now() - started).toBeLessThan(15_000);
    });

    it('toán tử Mongo trong query (q[$ne]=x, parentId[$gt]=) bị ValidationPipe chặn 400, không thành filter', async () => {
      for (const url of [
        '/crm/projects?q[$ne]=x',
        '/crm/projects?areaId[$ne]=x',
        '/crm/areas?parentId[$ne]=x',
        '/crm/areas?q[$regex]=.*',
        '/users?teamId[$ne]=x',
        '/users?role[$in]=ADMIN',
      ]) {
        const res = await call('GET', url, 'admin');
        expect([url, res.status]).toEqual([url, 400]);
      }
    });

    it('ObjectId sai => 400 (không bao giờ 500): query và path', async () => {
      const cases: Array<
        ['GET' | 'PATCH' | 'DELETE' | 'POST', string, unknown?]
      > = [
        ['GET', '/crm/areas?parentId=zzz'],
        ['GET', '/crm/projects?areaId=zzz'],
        ['GET', '/users?teamId=zzz'],
        ['GET', '/crm/assignable-users?teamId=zzz'],
        ['GET', '/crm/projects/zzz'],
        ['PATCH', '/teams/zzz', {}],
        ['DELETE', '/crm/areas/zzz'],
        ['PATCH', '/users/zzz/team', { teamId: null }],
        ['POST', '/crm/project-restorations', { projectId: 'zzz' }],
        ['POST', '/crm/areas', { name: 'x', type: 'OTHER', parentId: 'zzz' }],
        ['POST', '/teams', { name: 'x', code: 'X', managerIds: ['zzz'] }],
      ];
      for (const [method, url, body] of cases) {
        const res = await call(method, url, 'admin', body);
        expect([method, url, res.status]).toEqual([method, url, 400]);
      }
    });

    // Endpoint CŨ (không thuộc M1): id sai làm `new Types.ObjectId()` ném => 500 nếu thiếu ParseObjectIdPipe.
    it('PATCH /users/:id/role và /status với id sai trả 400 (hiện 500: thiếu ParseObjectIdPipe)', async () => {
      const role = await call('PATCH', '/users/zzz/role', 'admin', {
        role: 'EDITOR',
      });
      const status = await call('PATCH', '/users/zzz/status', 'admin', {
        status: 'ACTIVE',
      });
      expect([role.status, status.status]).toEqual([400, 400]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('PATCH nhận null (coder cho phép null ở nhiều field): field bắt buộc không được bị ghi null/500', () => {
    let sourceId: string;
    let areaId: string;
    let teamId: string;

    beforeAll(async () => {
      sourceId = (
        await call('POST', '/crm/lead-sources', 'admin', {
          code: 'NULLSRC',
          label: 'Nguồn null',
        })
      ).body.data.id;
      areaId = (
        await call('POST', '/crm/areas', 'admin', {
          name: 'Khu null',
          type: 'OTHER',
        })
      ).body.data.id;
      teamId = (
        await call('POST', '/teams', 'admin', {
          name: 'Nhóm null',
          code: 'NUL',
        })
      ).body.data.id;
    });

    it('PATCH /crm/lead-sources/:id {label:null} phải 400 và KHÔNG ghi label=null vào DB', async () => {
      const res = await call(
        'PATCH',
        `/crm/lead-sources/${sourceId}`,
        'admin',
        {
          label: null,
        },
      );
      const stored = await connection
        .collection('catalog_items')
        .findOne({ _id: new Types.ObjectId(sourceId) });
      expect(stored?.label).toBe('Nguồn null'); // dữ liệu không hỏng
      expect(res.status).toBe(400);
    });

    it('PATCH /crm/lead-sources/:id {order:null | isActive:null} phải 400 (không ghi null)', async () => {
      const a = await call('PATCH', `/crm/lead-sources/${sourceId}`, 'admin', {
        order: null,
      });
      const b = await call('PATCH', `/crm/lead-sources/${sourceId}`, 'admin', {
        isActive: null,
      });
      const stored = await connection
        .collection('catalog_items')
        .findOne({ _id: new Types.ObjectId(sourceId) });
      expect(stored?.order).not.toBeNull();
      expect(stored?.isActive).not.toBeNull();
      expect([a.status, b.status]).toEqual([400, 400]);
    });

    it('PATCH /crm/areas/:id {name:null} phải 400 (hiện 500 do normalizeVietnamese(null))', async () => {
      const res = await call('PATCH', `/crm/areas/${areaId}`, 'admin', {
        name: null,
      });
      expect(res.status).toBe(400);
    });

    it('PATCH /teams/:id {name:null | isActive:null} phải 400 và KHÔNG ghi null', async () => {
      const a = await call('PATCH', `/teams/${teamId}`, 'admin', {
        name: null,
      });
      const b = await call('PATCH', `/teams/${teamId}`, 'admin', {
        isActive: null,
      });
      const stored = await connection
        .collection('teams')
        .findOne({ _id: new Types.ObjectId(teamId) });
      expect(stored?.name).toBe('Nhóm null');
      expect(stored?.isActive).toBe(true);
      expect([a.status, b.status]).toEqual([400, 400]);
    });

    it('PATCH /teams/:id {managerIds:null} không được lặng lẽ xóa sạch quản lý (400, hoặc coi như không gửi)', async () => {
      const manager = ids.manager1;
      await call('PATCH', `/teams/${teamId}`, 'admin', {
        managerIds: [manager],
      });
      const res = await call('PATCH', `/teams/${teamId}`, 'admin', {
        managerIds: null,
      });
      const stored = await connection
        .collection('teams')
        .findOne({ _id: new Types.ObjectId(teamId) });
      if (res.status === 200) {
        expect(stored?.managerIds).toHaveLength(1);
      } else {
        expect(res.status).toBe(400);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Token cũ (JWT tin role) — tài khoản đã bị khóa / hạ quyền vẫn ghi được tới khi hết hạn token', () => {
    it('ADMIN bị khóa (status=BLOCKED) mà token còn hạn: ghi danh mục phải bị từ chối (401/403)', async () => {
      await createUser('doomedAdmin', UserRole.ADMIN);
      await userModel.updateOne(
        { _id: ids.doomedAdmin },
        { $set: { status: UserStatus.BLOCKED } },
      );
      const res = await call('POST', '/crm/lead-sources', 'doomedAdmin', {
        code: 'ZOMBIE',
        label: 'Admin đã khóa vẫn tạo được',
      });
      expect([401, 403]).toContain(res.status);
    });

    it('ADMIN bị hạ xuống EDITOR (DB) mà token còn hạn: ghi dự án phải bị từ chối', async () => {
      await createUser('demotedAdmin', UserRole.ADMIN);
      await userModel.updateOne(
        { _id: ids.demotedAdmin },
        { $set: { role: UserRole.EDITOR } },
      );
      const res = await call('POST', '/crm/projects', 'demotedAdmin', {
        name: 'Zombie',
        code: 'ZMB',
      });
      expect([401, 403]).toContain(res.status);
    });

    it('MANAGER bị khóa: các route CRM đọc theo CrmActor (assignable-users, teams) => 401 ngay (đọc DB, không tin JWT)', async () => {
      await createUser('doomedManager', UserRole.MANAGER);
      await userModel.updateOne(
        { _id: ids.doomedManager },
        { $set: { status: UserStatus.BLOCKED } },
      );
      expect(
        (await call('GET', '/crm/assignable-users', 'doomedManager')).status,
      ).toBe(401);
      expect((await call('GET', '/teams', 'doomedManager')).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Seed: Quản trị đổi tên/mã bản ghi seed thì seed lần khởi động sau không được tạo bản trùng', () => {
    it('đổi tên khu vực seed rồi seed lại => không sinh khu vực mới trùng tên gốc', async () => {
      const areas = connection.collection('areas');
      const original = await areas.findOne({
        nameNormalized: 'tp. ho chi minh',
        parentId: null,
      });
      if (!original) throw new Error('seed không có TP.HCM — cập nhật test');
      await areas.updateOne(
        { _id: original._id },
        { $set: { name: 'Sài Gòn', nameNormalized: 'sai gon' } },
      );
      const before = await areas.countDocuments({});
      await seed.seedAll();
      expect(await areas.countDocuments({})).toBe(before);
    });

    it('đổi mã dự án seed (PATCH code) rồi seed lại => không sinh dự án mới mang mã gốc', async () => {
      const projects = connection.collection('projects');
      const first = await projects.findOne({ deletedAt: null });
      if (!first) throw new Error('seed không có dự án — cập nhật test');
      const res = await call(
        'PATCH',
        `/crm/projects/${String(first._id)}`,
        'admin',
        {
          code: 'RECODED1',
        },
      );
      expect(res.status).toBe(200);
      const before = await projects.countDocuments({});
      await seed.seedAll();
      expect(await projects.countDocuments({})).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Bất biến "đúng 1 tình trạng mặc định" dưới tải đồng thời', () => {
    it('nhiều PATCH isDefault=true song song luôn để lại đúng một mặc định (thuộc NOT_CONTACTED, đang hoạt động)', async () => {
      const created: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        created.push(
          (
            await call('POST', '/crm/customer-statuses', 'admin', {
              code: `DEF_${index}`,
              label: `Mặc định thử ${index}`,
              listGroup: 'NOT_CONTACTED',
            })
          ).body.data.id,
        );
      }
      for (let round = 0; round < 4; round += 1) {
        await Promise.all(
          created.map((id) =>
            call('PATCH', `/crm/customer-statuses/${id}`, 'admin', {
              isDefault: true,
            }),
          ),
        );
        const defaults = await connection
          .collection('customer_statuses')
          .find({ isDefault: true, deletedAt: null })
          .toArray();
        expect(defaults).toHaveLength(1);
        expect(defaults[0].listGroup).toBe('NOT_CONTACTED');
        expect(defaults[0].isActive).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Đồng thời (write skew của snapshot isolation: hai transaction đọc dữ liệu cũ của nhau, không ghi cùng document)', () => {
    const ROUNDS = 8;

    it('hai request chuyển khu vực chéo nhau (A vào B, B vào A) không bao giờ tạo vòng cha-con', async () => {
      let sawCycle = false;
      for (let round = 0; round < ROUNDS && !sawCycle; round += 1) {
        const a = (
          await call('POST', '/crm/areas', 'admin', {
            name: `Cycle A ${round}`,
            type: 'OTHER',
          })
        ).body.data.id;
        const b = (
          await call('POST', '/crm/areas', 'admin', {
            name: `Cycle B ${round}`,
            type: 'OTHER',
          })
        ).body.data.id;
        await Promise.all([
          call('PATCH', `/crm/areas/${a}`, 'admin', { parentId: b }),
          call('PATCH', `/crm/areas/${b}`, 'admin', { parentId: a }),
        ]);
        const areas = connection.collection('areas');
        const [docA, docB] = await Promise.all([
          areas.findOne({ _id: new Types.ObjectId(a) }),
          areas.findOne({ _id: new Types.ObjectId(b) }),
        ]);
        sawCycle = String(docA?.parentId) === b && String(docB?.parentId) === a;
      }
      expect(sawCycle).toBe(false);
    });

    it('gán người vào nhóm đồng thời với xóa nhóm không bao giờ để người dùng trỏ vào nhóm đã xóa', async () => {
      let sawOrphan = false;
      for (let round = 0; round < ROUNDS && !sawOrphan; round += 1) {
        const key = `raceStaff${round}`;
        await createUser(key, UserRole.STAFF);
        const t = (
          await call('POST', '/teams', 'admin', {
            name: `Race ${round}`,
            code: `RACE${round}`,
          })
        ).body.data.id;
        await Promise.all([
          call('PATCH', `/users/${ids[key]}/team`, 'admin', { teamId: t }),
          call('DELETE', `/teams/${t}`, 'admin'),
        ]);
        const [user, team] = await Promise.all([
          userModel.findById(ids[key]).lean(),
          connection
            .collection('teams')
            .findOne({ _id: new Types.ObjectId(t) }),
        ]);
        sawOrphan = !!team?.deletedAt && String(user?.teamId) === t;
      }
      expect(sawOrphan).toBe(false);
    });
  });
});
