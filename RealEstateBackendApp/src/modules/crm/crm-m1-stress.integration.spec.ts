/**
 * INTEGRATION (QA bổ sung) — CRM M1: các ca đối kháng mà bộ `crm-m1.integration.spec.ts` chưa phủ.
 * Cùng harness: Fastify + ValidationPipe + GlobalExceptionFilter + JwtAuthGuard/RolesGuard thật
 * trên MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis/MinIO.
 *
 * Quy ước: `it(...)` = hành vi ĐÚNG phải giữ; `it(...)` = lỗi đã xác nhận ở review QA
 * (test đang đỏ-có-chủ-đích: khi coder sửa xong, Jest báo "failing test passed" => đổi lại thành `it`).
 */
/**
 * INTEGRATION (QA bổ sung, vòng 2): xác minh độc lập các bản sửa B1/S1-S6 của coder bằng tải đồng thời lặp 20-30 vòng
 * (khu vực chéo/vòng 3 nút, gán nhóm vs xóa nhóm vs tạo user, khóa/hạ ADMIN cuối chéo nhau), null trong PATCH,
 * audit đổi role/status, seed trên dữ liệu cũ chưa có seedKey. Cùng harness với crm-m1-qa.integration.spec.ts.
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

describe('CRM M1 — QA stress (đồng thời, ADMIN cuối, null, audit, seed cũ)', () => {
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

  const ROUNDS = 30;
  const statuses = (rs: Res[]) => rs.map((r) => r.status);

  it('chéo A<->B khu vực: 30 vòng, không vòng cha-con, không 500', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const a = (
        await call('POST', '/crm/areas', 'admin', {
          name: `CA${r}`,
          type: 'OTHER',
        })
      ).body.data.id;
      const b = (
        await call('POST', '/crm/areas', 'admin', {
          name: `CB${r}`,
          type: 'OTHER',
        })
      ).body.data.id;
      const res = await Promise.all([
        call('PATCH', `/crm/areas/${a}`, 'admin', { parentId: b }),
        call('PATCH', `/crm/areas/${b}`, 'admin', { parentId: a }),
      ]);
      const areas = connection.collection('areas');
      const [da, db] = await Promise.all([
        areas.findOne({ _id: new Types.ObjectId(a) }),
        areas.findOne({ _id: new Types.ObjectId(b) }),
      ]);
      expect([
        r,
        String(da?.parentId) === b && String(db?.parentId) === a,
        statuses(res).filter((x) => x >= 500).length,
      ]).toEqual([r, false, 0]);
    }
  });

  it('chu trình 3 nút song song: 20 vòng, không có vòng', async () => {
    for (let r = 0; r < 20; r += 1) {
      const mk = async (n: string) =>
        (
          await call('POST', '/crm/areas', 'admin', {
            name: `T${n}${r}`,
            type: 'OTHER',
          })
        ).body.data.id as string;
      const [a, b, c] = [await mk('a'), await mk('b'), await mk('c')];
      await Promise.all([
        call('PATCH', `/crm/areas/${a}`, 'admin', { parentId: b }),
        call('PATCH', `/crm/areas/${b}`, 'admin', { parentId: c }),
        call('PATCH', `/crm/areas/${c}`, 'admin', { parentId: a }),
      ]);
      const docs = await connection
        .collection('areas')
        .find({ _id: { $in: [a, b, c].map((x) => new Types.ObjectId(x)) } })
        .toArray();
      const parent = new Map(
        docs.map((d) => [
          String(d._id),
          d.parentId ? String(d.parentId) : null,
        ]),
      );
      for (const start of [a, b, c]) {
        let cur: string | null = start;
        let steps = 0;
        while (cur && steps < 5) {
          cur = parent.get(cur) ?? null;
          steps += 1;
        }
        expect([r, start, steps >= 5]).toEqual([r, start, false]);
      }
    }
  });

  it('gán nhóm + tạo user kèm teamId song song xóa nhóm: 30 vòng, không mồ côi, không 500', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const key = `zs${r}`;
      await createUser(key, UserRole.STAFF);
      const t = (
        await call('POST', '/teams', 'admin', {
          name: `ZT${r}`,
          code: `ZT${r}`,
        })
      ).body.data.id;
      const res = await Promise.all([
        call('PATCH', `/users/${ids[key]}/team`, 'admin', { teamId: t }),
        call('DELETE', `/teams/${t}`, 'admin'),
        call('POST', '/users', 'admin', {
          email: `zc${r}@qa.vn`,
          password: 'Aa@123456789',
          displayName: 'zc',
          role: 'STAFF',
          teamId: t,
        }),
      ]);
      const team = await connection
        .collection('teams')
        .findOne({ _id: new Types.ObjectId(t) });
      const members = await userModel.countDocuments({
        teamId: new Types.ObjectId(t),
      });
      expect([
        r,
        !!team?.deletedAt && members > 0,
        statuses(res).filter((x) => x >= 500).length,
      ]).toEqual([r, false, 0]);
    }
  });

  it('ADMIN cuối cùng: khóa/hạ chéo nhau song song 30 vòng luôn còn >=1 ADMIN ACTIVE', async () => {
    await userModel.updateMany(
      { role: UserRole.ADMIN },
      { $set: { status: UserStatus.BLOCKED } },
    );
    for (let r = 0; r < ROUNDS; r += 1) {
      await createUser(`laA${r}`, UserRole.ADMIN);
      await createUser(`laB${r}`, UserRole.ADMIN);
      const res = await Promise.all([
        call('PATCH', `/users/${ids[`laB${r}`]}/status`, `laA${r}`, {
          status: 'BLOCKED',
        }),
        call('PATCH', `/users/${ids[`laA${r}`]}/role`, `laB${r}`, {
          role: 'EDITOR',
        }),
      ]);
      const active = await userModel.countDocuments({
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      });
      expect([
        r,
        active >= 1,
        statuses(res).filter((x) => x >= 500).length,
      ]).toEqual([r, true, 0]);
      // dọn: khóa mọi admin của vòng này (bằng DB) để vòng sau độc lập
      await userModel.updateMany(
        { email: { $in: [`laA${r}@qa.vn`, `laB${r}@qa.vn`] } },
        { $set: { status: UserStatus.BLOCKED } },
      );
    }
  });

  it('ADMIN cuối cùng đơn lẻ: hạ role => 409 LAST_ADMIN_REQUIRED, không audit khi bị chặn', async () => {
    await userModel.updateMany(
      { role: UserRole.ADMIN },
      { $set: { status: UserStatus.BLOCKED } },
    );
    await createUser('soloAdmin', UserRole.ADMIN);
    const before = await connection
      .collection('crm_audit_logs')
      .countDocuments({ entityId: new Types.ObjectId(ids.soloAdmin) });
    const demote = await call(
      'PATCH',
      `/users/${ids.soloAdmin}/role`,
      'soloAdmin',
      { role: 'STAFF' },
    );
    expect([demote.status, demote.body.errorCode]).toEqual([
      409,
      'LAST_ADMIN_REQUIRED',
    ]);
    expect(
      (
        await call('PATCH', `/users/${ids.soloAdmin}/status`, 'soloAdmin', {
          status: 'BLOCKED',
        })
      ).status,
    ).toBe(403);
    expect(
      await connection
        .collection('crm_audit_logs')
        .countDocuments({ entityId: new Types.ObjectId(ids.soloAdmin) }),
    ).toBe(before);
    expect((await userModel.findById(ids.soloAdmin).lean())?.role).toBe(
      UserRole.ADMIN,
    );
    // admin khác khóa admin cuối: cũng 409
    await createUser('soloOther', UserRole.ADMIN);
    await userModel.updateOne(
      { _id: ids.soloOther },
      { $set: { status: UserStatus.BLOCKED } },
    );
    // soloOther bị khóa nên token của nó trả 401 (ActiveAdminGuard); dùng token soloAdmin khóa chính nó bị 403, nên chỉ kiểm hạ role đã đủ
    await userModel.updateMany(
      { email: /^(admin|soloAdmin)@/ },
      { $set: { status: UserStatus.ACTIVE, role: UserRole.ADMIN } },
    );
  });

  it('audit đổi role/status: cùng transaction, actorRole/actorName từ DB, no-op không audit', async () => {
    await createUser('auditTarget', UserRole.STAFF);
    expect(
      (
        await call('PATCH', `/users/${ids.auditTarget}/role`, 'admin', {
          role: 'MANAGER',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `/users/${ids.auditTarget}/role`, 'admin', {
          role: 'MANAGER',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `/users/${ids.auditTarget}/status`, 'admin', {
          status: 'BLOCKED',
        })
      ).status,
    ).toBe(200);
    const logs = await connection
      .collection('crm_audit_logs')
      .find({ entityId: new Types.ObjectId(ids.auditTarget) })
      .sort({ _id: 1 })
      .toArray();
    expect(logs.map((l) => l.action)).toEqual([
      'USER_ROLE_CHANGED',
      'USER_STATUS_CHANGED',
    ]);
    expect(logs[0]).toMatchObject({ actorName: 'admin', actorRole: 'ADMIN' });
    expect(JSON.stringify(logs)).not.toMatch(/password|hash/i);
  });

  it('null: bị 400 ở field bắt buộc; hợp lệ ở field có chủ đích; hạ MANAGER gỡ managerIds; id sai 400', async () => {
    const t = (
      await call('POST', '/teams', 'admin', { name: 'NullT', code: 'NULLT' })
    ).body.data.id;
    await createUser('mgrDemote', UserRole.MANAGER);
    await call('PATCH', `/teams/${t}`, 'admin', {
      managerIds: [ids.mgrDemote],
    });
    await call('PATCH', `/users/${ids.mgrDemote}/role`, 'admin', {
      role: 'STAFF',
    });
    expect(
      (
        await connection
          .collection('teams')
          .findOne({ _id: new Types.ObjectId(t) })
      )?.managerIds,
    ).toEqual([]);
    expect(
      (await call('PATCH', '/users/zzz/role', 'admin', { role: 'EDITOR' }))
        .status,
    ).toBe(400);
    expect(
      (await call('PATCH', '/users/zzz/status', 'admin', { status: 'ACTIVE' }))
        .status,
    ).toBe(400);
    for (const body of [
      { name: null },
      { isActive: null },
      { managerIds: null },
    ]) {
      expect([
        JSON.stringify(body),
        (await call('PATCH', `/teams/${t}`, 'admin', body)).status,
      ]).toEqual([JSON.stringify(body), 400]);
    }
    const res = (
      await call('POST', '/crm/contact-results', 'admin', {
        code: 'NN_RES',
        label: 'x',
        suggestedFollowUpDays: 3,
        suggestionText: 'abc',
      })
    ).body.data.id;
    const ok = await call('PATCH', `/crm/contact-results/${res}`, 'admin', {
      suggestedFollowUpDays: null,
    });
    expect([ok.status, ok.body.data.suggestedFollowUpDays]).toEqual([
      200,
      null,
    ]);
    expect(
      (
        await call('PATCH', `/crm/contact-results/${res}`, 'admin', {
          suggestionText: null,
        })
      ).status,
    ).toBe(400);
    const area = (
      await call('POST', '/crm/areas', 'admin', {
        name: 'NN root',
        type: 'OTHER',
      })
    ).body.data.id;
    const child = (
      await call('POST', '/crm/areas', 'admin', {
        name: 'NN child',
        type: 'OTHER',
        parentId: area,
      })
    ).body.data.id;
    const toRoot = await call('PATCH', `/crm/areas/${child}`, 'admin', {
      parentId: null,
    });
    expect([toRoot.status, toRoot.body.data.parentId]).toEqual([200, null]);
    expect(
      (await call('PATCH', `/crm/areas/${child}`, 'admin', { name: null }))
        .status,
    ).toBe(400);
    const st = (
      await call('POST', '/crm/customer-statuses', 'admin', {
        code: 'NN_ST',
        label: 'x',
        listGroup: 'NET',
        color: 'red',
      })
    ).body.data.id;
    const clr = await call('PATCH', `/crm/customer-statuses/${st}`, 'admin', {
      color: null,
    });
    expect([clr.status, clr.body.data.color]).toEqual([200, null]);
    expect(
      (
        await call('PATCH', `/crm/customer-statuses/${st}`, 'admin', {
          label: null,
        })
      ).status,
    ).toBe(400);
    const src = (
      await call('POST', '/crm/lead-sources', 'admin', {
        code: 'NN_SRC',
        label: 'x',
      })
    ).body.data.id;
    for (const body of [{ label: null }, { order: null }, { isActive: null }]) {
      expect([
        JSON.stringify(body),
        (await call('PATCH', `/crm/lead-sources/${src}`, 'admin', body)).status,
      ]).toEqual([JSON.stringify(body), 400]);
    }
  });

  it('seed: dữ liệu seed cũ (không seedKey) gắn bổ sung không nhân đôi; đổi tên/mã rồi seed lại 3 lần không trùng', async () => {
    const areas = connection.collection('areas');
    const projects = connection.collection('projects');
    const cols = ['areas', 'projects', 'catalog_items', 'customer_statuses'];
    await Promise.all(
      cols.map((c) =>
        connection.collection(c).updateMany({}, { $unset: { seedKey: '' } }),
      ),
    );
    const total = async () =>
      Promise.all(cols.map((c) => connection.collection(c).countDocuments({})));
    const before = await total();
    const rep = await seed.seedAll();
    expect(await total()).toEqual(before);
    expect(Object.values(rep).every((n) => n === 0)).toBe(true);
    // bản ghi seed cũ đã được gắn seedKey bổ sung
    expect(
      await areas.countDocuments({ seedKey: { $type: 'string' } }),
    ).toBeGreaterThan(10);
    const hcm = await areas.findOne({
      seedKey: { $regex: '^AREA:tp. ho chi minh$' },
    });
    expect(hcm).not.toBeNull();
    await areas.updateOne(
      { _id: hcm!._id },
      { $set: { name: 'Sài Gòn', nameNormalized: 'sai gon' } },
    );
    const q1 = await areas.findOne({
      seedKey: { $regex: '^AREA:tp. ho chi minh/quan 1$' },
    });
    const other = await areas.findOne({
      parentId: null,
      seedKey: { $type: 'string' },
      _id: { $ne: hcm!._id },
    });
    expect(
      (
        await call('PATCH', `/crm/areas/${String(q1!._id)}`, 'admin', {
          parentId: String(other!._id),
        })
      ).status,
    ).toBe(200);
    const pj = await projects.findOne({
      seedKey: { $type: 'string' },
      deletedAt: null,
    });
    expect(
      (
        await call('PATCH', `/crm/projects/${String(pj!._id)}`, 'admin', {
          code: 'RECODED9',
        })
      ).status,
    ).toBe(200);
    await connection
      .collection('customer_statuses')
      .updateOne(
        { seedKey: 'STATUS:INTERESTED' },
        { $set: { label: 'Đã sửa' } },
      );
    const snap = await total();
    for (let i = 0; i < 3; i += 1) await seed.seedAll();
    expect(await total()).toEqual(snap);
    expect(
      (
        await connection
          .collection('customer_statuses')
          .findOne({ code: 'INTERESTED' })
      )?.label,
    ).toBe('Đã sửa');
  });
});
