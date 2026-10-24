/**
 * INTEGRATION (QA bổ sung, M2): các ca đối kháng mà crm-m2.integration.spec.ts chưa phủ - ma trận EDITOR/ẩn danh ở mọi
 * route khách, bộ lọc không mở rộng phạm vi, chống dò số kiểu lách, Redis lỗi => 503, cảnh báo xem số/CCCD,
 * idempotency/version đồng thời, PII còn sót trong audit sau khi ẩn danh hóa, tham số lạ => 400.
 * Cùng harness (Replica Set tạm + Redis dev). it.failing = lỗi đã xác nhận ở review QA.
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
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
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

describe('CRM M2 — QA đối kháng (HTTP + Replica Set + Redis)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

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
  const redisKey = (suffix: string) => suffix;

  describe('Ma trận quyền đầy đủ cho EDITOR/chưa đăng nhập + ngoài phạm vi', () => {
    let cust: string;
    beforeAll(async () => {
      cust = (
        await createCustomer('admin', {
          careTeam: { memberIds: [], primaryUserId: ids.staffA },
        })
      ).id;
    });

    it('EDITOR 403 và chưa đăng nhập 401 ở MỌI route khách', async () => {
      const probes: Array<
        ['GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', string]
      > = [
        ['GET', '/crm/customers'],
        ['GET', '/crm/customers/list-counts'],
        ['POST', '/crm/customers/phone-lookups'],
        ['POST', '/crm/customers'],
        ['GET', `/crm/customers/${cust}`],
        ['PATCH', `/crm/customers/${cust}`],
        ['PATCH', `/crm/customers/${cust}/status`],
        ['PATCH', `/crm/customers/${cust}/criteria`],
        ['PUT', `/crm/customers/${cust}/data-consent`],
        ['DELETE', `/crm/customers/${cust}?reason=x`],
        ['PUT', `/crm/customers/${cust}/national-id`],
        ['DELETE', `/crm/customers/${cust}/national-id`],
        ['POST', `/crm/customers/${cust}/national-id-views`],
        ['GET', `/crm/customers/${cust}/national-id-views`],
        ['POST', `/crm/customers/${cust}/phone-views`],
        ['GET', `/crm/customers/${cust}/histories`],
        ['GET', '/crm/deleted-customers'],
        ['POST', '/crm/customer-restorations'],
        ['POST', '/crm/customer-anonymizations'],
        ['GET', '/crm/audit-logs'],
      ];
      for (const [method, url] of probes) {
        const editor = await call(method, url, 'editor', {});
        const anon = await call(method, url, null, {});
        expect([method, url, editor.status, anon.status]).toEqual([
          method,
          url,
          403,
          401,
        ]);
      }
    });

    it('route ADMIN-only: MANAGER/STAFF 403 (restore, anonymize, deleted-customers, audit-logs)', async () => {
      for (const who of ['manager1', 'staffA']) {
        for (const [method, url, body] of [
          ['GET', '/crm/deleted-customers', undefined],
          ['GET', '/crm/audit-logs', undefined],
          ['POST', '/crm/customer-restorations', { customerId: cust }],
          [
            'POST',
            '/crm/customer-anonymizations',
            { customerId: cust, reason: 'x', confirm: true },
          ],
        ] as const) {
          const res = await call(method, url, who, body);
          expect([who, method, url, res.status]).toEqual([
            who,
            method,
            url,
            403,
          ]);
        }
      }
      // khách không bị ảnh hưởng
      expect(
        (await call('GET', `/crm/customers/${cust}`, 'admin')).status,
      ).toBe(200);
    });

    it('GET national-id-views (nhật ký xem CCCD): Quản lý ngoài phạm vi 404, Nhân viên 403 (kể cả phụ trách chính), Quản lý trong phạm vi 200', async () => {
      expect(
        (
          await call(
            'GET',
            `/crm/customers/${cust}/national-id-views`,
            'manager2',
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            'GET',
            `/crm/customers/${cust}/national-id-views`,
            'staffA',
          )
        ).status,
      ).toBe(403);
      expect(
        (await call('GET', `/crm/customers/${cust}/national-id-views`, 'admin'))
          .status,
      ).toBe(200);
    });

    it('bộ lọc query không thể mở rộng phạm vi: teamIds/assigneeIds/projectIds/q của người khác vẫn chỉ trả khách trong phạm vi', async () => {
      const inB = await createCustomer('admin', {
        fullName: 'Khach Nhom B Rieng',
        careTeam: { memberIds: [], primaryUserId: ids.staffC },
      });
      const probes = [
        `?teamIds=${ids.teamB}`,
        `?assigneeIds=${ids.staffC}`,
        `?primaryAssigneeIds=${ids.staffC}`,
        `?q=${encodeURIComponent('Khach Nhom B Rieng')}`,
        `?q=${inB.phone.slice(-6)}`,
        `?listGroup=NOT_CONTACTED&q=Khach`,
      ];
      for (const q of probes) {
        for (const who of ['staffA', 'manager1']) {
          const seen = await listIds(who, `&${q.slice(1)}`);
          expect([who, q, seen.includes(inB.id)]).toEqual([who, q, false]);
        }
      }
      const counts = await call(
        'GET',
        `/crm/customers/list-counts?q=${encodeURIComponent('Khach Nhom B Rieng')}`,
        'staffA',
      );
      expect(counts.body.data.ALL).toBe(0);
    });

    it('MANAGER chỉ thấy nhóm mình QUẢN LÝ: nhóm mình thuộc về (mà không quản lý) không mở phạm vi', async () => {
      await createUser('managerMember', UserRole.MANAGER);
      await call('PATCH', `/users/${ids.managerMember}/team`, 'admin', {
        teamId: ids.teamA,
      });
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffB },
      });
      expect((await listIds('managerMember')).includes(c.id)).toBe(false);
      expect(
        (await call('GET', `/crm/customers/${c.id}`, 'managerMember')).status,
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Response không bao giờ trả SĐT đầy đủ (trừ phone-views và histories theo #34)', () => {
    it('create/detail/list/counts/status/criteria/restore/deleted-list: không có số đầy đủ, không searchText/nationalId', async () => {
      const created = await createCustomer('staffA', {
        fullName: 'Ten Thuong',
        nationalId: '012345678901',
        email: 'leak@test.vn',
      });
      const digits = created.phone.replace(/^0/, '');
      const e164 = `+84${digits}`;
      const bodies: unknown[] = [created.res.body];
      const detail = await call(
        'GET',
        `/crm/customers/${created.id}`,
        'staffA',
      );
      bodies.push(detail.body);
      bodies.push(
        (await call('GET', '/crm/customers?limit=100', 'staffA')).body,
      );
      bodies.push(
        (await call('GET', '/crm/customers/list-counts', 'staffA')).body,
      );
      bodies.push(
        (
          await call('PATCH', `/crm/customers/${created.id}/status`, 'staffA', {
            statusId: status.INTERESTED,
            version: detail.body.data.version,
          })
        ).body,
      );
      const fresh = await call('GET', `/crm/customers/${created.id}`, 'staffA');
      bodies.push(
        (
          await call(
            'PATCH',
            `/crm/customers/${created.id}/criteria`,
            'staffA',
            {
              version: fresh.body.data.version,
              demand: { isDone: true, description: 'x' },
            },
          )
        ).body,
      );
      bodies.push(
        (
          await call(
            'PUT',
            `/crm/customers/${created.id}/national-id`,
            'staffA',
            { nationalId: '987654321012' },
          )
        ).body,
      );
      bodies.push(
        (
          await call(
            'DELETE',
            `/crm/customers/${created.id}?reason=t`,
            'manager1',
          )
        ).body,
      );
      bodies.push((await call('GET', '/crm/deleted-customers', 'admin')).body);
      bodies.push(
        (
          await call('POST', '/crm/customer-restorations', 'admin', {
            customerId: created.id,
          })
        ).body,
      );
      const json = JSON.stringify(bodies);
      for (const secret of [
        created.phone,
        digits,
        e164,
        '012345678901',
        '987654321012',
        'searchText',
      ]) {
        expect([secret, json.includes(secret)]).toEqual([secret, false]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Chống dò số (bổ sung)', () => {
    it('từ khóa trá hình không lách được: dấu +, ngoặc, chữ lẫn số, regex, ký tự toàn chiều rộng', async () => {
      const seed = await createCustomer('admin', {
        fullName: 'Probe Target',
        careTeam: { memberIds: [], primaryUserId: ids.staffD },
      });
      const national = seed.phone; // 091xxxxxxx
      const probes = [
        national.slice(0, 3), // 3 số
        `${national.slice(0, 3)}.`,
        `(${national.slice(0, 3)})`,
        `+84${national.slice(1, 4)}`, // "+84912" => 5 số, nhưng không phải đuôi
        `84${national.slice(1, 4)}`,
        `${national.slice(0, 5)}`, // 5 số đầu (không phải đuôi)
        `${national.slice(0, 4)}.*`,
        `^${national.slice(0, 5)}`,
        `０９１${national.slice(3, 5)}`,
      ];
      for (const q of probes) {
        const res = await call(
          'GET',
          `/crm/customers?limit=100&q=${encodeURIComponent(q)}`,
          'admin',
        );
        expect([q, res.status]).toEqual([q, 200]);
        expect([
          q,
          res.body.data.some((row: { id: string }) => row.id === seed.id),
        ]).toEqual([q, false]);
      }
      // đuôi 4 số cuối khớp; 6 số trở lên khớp chuỗi con
      const tail = national.slice(-4);
      const withTail = await listIds('admin', `&q=${tail}`);
      expect(withTail).toContain(seed.id);
      const sub = await listIds('admin', `&q=${national.slice(2, 8)}`);
      expect(sub).toContain(seed.id);
    });

    it('Redis lỗi => 503 (fail-closed) cho phone-lookups, phone-views, national-id-views, tìm kiếm; không lộ số', async () => {
      const redis = app.get<{ eval: (...args: unknown[]) => Promise<unknown> }>(
        REDIS_CLIENT,
      );
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffD },
        nationalId: '111222333444',
      });
      const spy = jest
        .spyOn(redis, 'eval')
        .mockRejectedValue(new Error('redis down'));
      try {
        const attempts: Array<[string, 'GET' | 'POST', string, unknown]> = [
          [
            'lookup',
            'POST',
            '/crm/customers/phone-lookups',
            { phone: c.phone },
          ],
          [
            'phone-view',
            'POST',
            `/crm/customers/${c.id}/phone-views`,
            { purpose: 'VIEW' },
          ],
          ['cccd-view', 'POST', `/crm/customers/${c.id}/national-id-views`, {}],
          ['search', 'GET', '/crm/customers?q=abc', undefined],
        ];
        for (const [name, method, url, body] of attempts) {
          const res = await call(method, url, 'admin', body);
          expect([name, res.status, res.body.errorCode]).toEqual([
            name,
            503,
            'SERVICE_UNAVAILABLE',
          ]);
          expect(JSON.stringify(res.body)).not.toContain(c.phone);
          expect(JSON.stringify(res.body)).not.toContain('111222333444');
        }
        // không có audit PHONE_VIEWED/NATIONAL_ID_VIEWED khi bị từ chối
        expect(await auditOf(c.id, 'PHONE_VIEWED')).toHaveLength(0);
        expect(await auditOf(c.id, 'NATIONAL_ID_VIEWED')).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
      // list không từ khóa không phụ thuộc Redis
      expect((await call('GET', '/crm/customers', 'admin')).status).toBe(200);
    });

    it('PHONE_VIEW_ALERT: vượt ngưỡng phoneViewAlertPerHour ghi đúng 1 cảnh báo/giờ; NATIONAL_ID_VIEW_ALERT sau 50 lượt', async () => {
      await createUser('viewer', UserRole.MANAGER);
      await call('PATCH', `/teams/${ids.teamA}`, 'admin', {
        managerIds: [ids.manager1, ids.viewer],
      });
      expect(
        (
          await call('PATCH', '/crm/settings', 'admin', {
            phoneViewAlertPerHour: 3,
          })
        ).status,
      ).toBe(200);
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
        nationalId: '555666777888',
      });
      try {
        for (let index = 0; index < 6; index += 1) {
          const res = await call(
            'POST',
            `/crm/customers/${c.id}/phone-views`,
            'viewer',
            { purpose: 'VIEW' },
          );
          expect(res.status).toBe(201);
        }
      } finally {
        await call('PATCH', '/crm/settings', 'admin', {
          phoneViewAlertPerHour: 200,
        });
      }
      const alerts = await connection
        .collection('crm_audit_logs')
        .find({
          action: 'PHONE_VIEW_ALERT',
          actorId: new Types.ObjectId(ids.viewer),
        })
        .toArray();
      expect(alerts).toHaveLength(1);
      expect(JSON.stringify(alerts)).not.toContain(c.phone);

      const redis = app.get<{ set: (...args: unknown[]) => Promise<unknown> }>(
        REDIS_CLIENT,
      );
      await redis.set(
        redisKey(`crm:abuse:national-id-view:${ids.viewer}`),
        49,
        'EX',
        3600,
      );
      for (let index = 0; index < 3; index += 1) {
        expect(
          (
            await call(
              'POST',
              `/crm/customers/${c.id}/national-id-views`,
              'viewer',
              {},
            )
          ).status,
        ).toBe(201);
      }
      const idAlerts = await connection
        .collection('crm_audit_logs')
        .find({
          action: 'NATIONAL_ID_VIEW_ALERT',
          actorId: new Types.ObjectId(ids.viewer),
        })
        .toArray();
      expect(idAlerts).toHaveLength(1);
    });

    it('phone-lookups cho số của khách NGOÀI phạm vi: chỉ tên người phụ trách + customerRef, không lộ họ tên/email/SĐT; PHONE_LOOKUP ghi 1 bản/lần', async () => {
      const c = await createCustomer('admin', {
        fullName: 'Bí Mật Họ Tên',
        email: 'bimat@example.com',
        careTeam: { memberIds: [], primaryUserId: ids.staffC },
      });
      const before = (await auditOf(c.id, 'PHONE_LOOKUP')).length;
      const res = await call('POST', '/crm/customers/phone-lookups', 'staffA', {
        phone: c.phone,
      });
      expect(res.status).toBe(200);
      const json = JSON.stringify(res.body);
      for (const secret of ['Bí Mật', 'bimat@', 'searchText']) {
        expect(json).not.toContain(secret);
      }
      // số điện thoại chỉ xuất hiện ở normalizedPhone (chính là input người tra gửi lên)
      const { normalizedPhone, ...rest } = res.body.data;
      expect(normalizedPhone).toBe(`+84${c.phone.slice(1)}`);
      expect(JSON.stringify(rest)).not.toContain(c.phone.slice(3));
      expect(res.body.data).toMatchObject({
        exists: true,
        isAccessible: false,
        caredByName: 'staffC',
      });
      expect((await auditOf(c.id, 'PHONE_LOOKUP')).length).toBe(before + 1);
      // lỗi 409 khi tạo trùng cũng chỉ có cùng thông tin
      const dup = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'x',
        phone: c.phone,
      });
      expect(dup.status).toBe(409);
      expect(JSON.stringify(dup.body)).not.toContain('Bí Mật');
      expect(JSON.stringify(dup.body)).not.toContain('bimat@');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('PHONE_SEARCH_ANOMALY: báo động giả khi người dùng chỉ gõ dần một số điện thoại', () => {
    it('gõ từng ký tự của 2 số điện thoại (tiền tố 2..10 chữ số; q tối thiểu 2 ký tự theo doc 05 mục 1.4) không được bị coi là dò số', async () => {
      await createUser('typist', UserRole.MANAGER);
      await call('PATCH', `/teams/${ids.teamA}`, 'admin', {
        managerIds: [ids.manager1, ids.typist],
      });
      for (const full of ['0912345678', '0987654321']) {
        for (let length = 2; length <= full.length; length += 1) {
          const res = await call(
            'GET',
            `/crm/customers?q=${full.slice(0, length)}`,
            'typist',
          );
          expect(res.status).toBe(200);
        }
      }
      const alerts = await connection
        .collection('crm_audit_logs')
        .countDocuments({
          action: 'PHONE_SEARCH_ANOMALY',
          actorId: new Types.ObjectId(ids.typist),
        });
      expect(alerts).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Lách giới hạn phone-lookups qua đường tạo/sửa khách (409 trùng SĐT tiết lộ cùng thông tin)', () => {
    it('POST /crm/customers với số đã có của khách ngoài phạm vi phải bị giới hạn tốc độ như phone-lookups (30/phút/người)', async () => {
      await createUser('prober', UserRole.STAFF);
      const targets: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        targets.push(
          (
            await createCustomer('admin', {
              careTeam: { memberIds: [], primaryUserId: ids.staffC },
            })
          ).phone,
        );
      }
      const statuses: number[] = [];
      for (let index = 0; index < 40; index += 1) {
        const res = await call('POST', '/crm/customers', 'prober', {
          fullName: 'Probe',
          phone: targets[index % targets.length],
        });
        statuses.push(res.status);
      }
      // mong đợi: có 429 sau ~30 lần; thực tế mọi lần đều 409 và lộ caredByName
      expect(statuses).toContain(429);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('PHONE_SEARCH_ANOMALY: né quy tắc "tiền tố của từ khóa liền trước"', () => {
    it('dò 24 số (mở rộng của một từ khóa gốc, xen kẽ gốc) vẫn phải sinh cảnh báo', async () => {
      await createUser('sneaky', UserRole.MANAGER);
      await call('PATCH', `/teams/${ids.teamA}`, 'admin', {
        managerIds: [ids.manager1, ids.sneaky],
      });
      const base = '091200';
      const guesses: string[] = [];
      for (let d = 0; d < 10; d += 1) guesses.push(`${base}${d}`);
      for (let d = 0; d < 14; d += 1) guesses.push(`${base}0${d}`);
      for (const guess of guesses) {
        expect(
          (await call('GET', `/crm/customers?q=${base}`, 'sneaky')).status,
        ).toBe(200);
        expect(
          (await call('GET', `/crm/customers?q=${guess}`, 'sneaky')).status,
        ).toBe(200);
      }
      const alerts = await connection
        .collection('crm_audit_logs')
        .countDocuments({
          action: 'PHONE_SEARCH_ANOMALY',
          actorId: new Types.ObjectId(ids.sneaky),
        });
      expect(alerts).toBe(1);
    });

    it('xen kẽ NHIỀU gốc + viết khác nhau (dấu cách, dấu chấm, 84xxx, +84) vẫn sinh cảnh báo; gõ dần/xóa bớt không báo giả', async () => {
      await createUser('multi', UserRole.MANAGER);
      await call('PATCH', `/teams/${ids.teamA}`, 'admin', {
        managerIds: [ids.manager1, ids.multi],
      });
      const bases = ['091300', '097700', '093100'];
      const forms = [
        (s: string) => s,
        (s: string) => `${s.slice(0, 4)} ${s.slice(4)}`,
        (s: string) => `${s.slice(0, 4)}.${s.slice(4)}`,
        (s: string) => `+84${s.slice(1)}`,
      ];
      let n = 0;
      for (let i = 0; i < 12 && n < 21; i += 1) {
        for (const base of bases) {
          await call(
            'GET',
            `/crm/customers?q=${encodeURIComponent(base)}`,
            'multi',
          );
          const guess = forms[(i + n) % forms.length](`${base}${i}`);
          await call(
            'GET',
            `/crm/customers?q=${encodeURIComponent(guess)}`,
            'multi',
          );
          n += 1;
        }
      }
      const count = (actor: string) =>
        connection.collection('crm_audit_logs').countDocuments({
          action: 'PHONE_SEARCH_ANOMALY',
          actorId: new Types.ObjectId(ids[actor]),
        });
      expect(await count('multi')).toBe(1);

      await createUser('typist2', UserRole.MANAGER);
      await call('PATCH', `/teams/${ids.teamA}`, 'admin', {
        managerIds: [ids.manager1, ids.multi, ids.typist2],
      });
      for (const full of ['0911111111', '0922222222']) {
        for (let l = 2; l <= full.length; l += 1) {
          await call('GET', `/crm/customers?q=${full.slice(0, l)}`, 'typist2');
        }
        for (let l = full.length - 1; l >= 6; l -= 1) {
          await call('GET', `/crm/customers?q=${full.slice(0, l)}`, 'typist2');
        }
      }
      expect(await count('typist2')).toBe(0);
    });

    it('dò 24 số không liên quan nhau vẫn sinh đúng 1 cảnh báo', async () => {
      await createUser('prober2', UserRole.MANAGER);
      await call('PATCH', `/teams/${ids.teamA}`, 'admin', {
        managerIds: [ids.manager1, ids.prober2],
      });
      for (let i = 0; i < 24; i += 1) {
        const q = `09${10 + i}${String(100000 + i * 7919).slice(0, 6)}`;
        expect(
          (await call('GET', `/crm/customers?q=${q}`, 'prober2')).status,
        ).toBe(200);
      }
      const alerts = await connection
        .collection('crm_audit_logs')
        .countDocuments({
          action: 'PHONE_SEARCH_ANOMALY',
          actorId: new Types.ObjectId(ids.prober2),
        });
      expect(alerts).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Idempotency + optimistic lock (bổ sung)', () => {
    it('double-click đồng thời cùng X-Idempotency-Key cùng user: đúng 1 khách được tạo', async () => {
      const phone = nextPhone();
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          call(
            'POST',
            '/crm/customers',
            'staffA',
            { fullName: 'Double', phone },
            { 'x-idempotency-key': key },
          ),
        ),
      );
      expect(
        await customers().countDocuments({
          phone: { $regex: `${phone.slice(1)}$` },
        }),
      ).toBe(1);
      for (const res of results) {
        expect([201, 409]).toContain(res.status);
        if (res.status === 409) {
          expect([
            'IDEMPOTENCY_IN_PROGRESS',
            'CUSTOMER_PHONE_DUPLICATED',
          ]).toContain(res.body.errorCode);
        }
      }
      expect(
        results.filter((res) => res.status === 201).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('20 PATCH đồng thời cùng version: đúng 1 thành công, version tăng đúng 1, đúng 1 audit CUSTOMER_UPDATED', async () => {
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          call('PATCH', `/crm/customers/${c.id}`, 'admin', {
            version: 0,
            fullName: `Tên ${index}`,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.filter(
          (r) => r.status === 409 && r.body.errorCode === 'VERSION_CONFLICT',
        ),
      ).toHaveLength(19);
      expect(
        (await customers().findOne({ _id: new Types.ObjectId(c.id) }))!.__v,
      ).toBe(1);
      expect(await auditOf(c.id, 'CUSTOMER_UPDATED')).toHaveLength(1);
    });

    it('PATCH với field null cho trường bắt buộc/lạ bị 400; email/sourceId/areaId = null hợp lệ', async () => {
      const c = await createCustomer('admin', {
        email: 'a@b.vn',
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
      });
      for (const body of [
        { fullName: null },
        { phone: null },
        { interestedProjectIds: null },
        { statusId: status.NET },
        { careTeam: {} },
        { __v: 5 },
      ]) {
        const res = await call('PATCH', `/crm/customers/${c.id}`, 'admin', {
          version: 0,
          ...body,
        });
        expect([JSON.stringify(body), res.status]).toEqual([
          JSON.stringify(body),
          400,
        ]);
      }
      const ok = await call('PATCH', `/crm/customers/${c.id}`, 'admin', {
        version: 0,
        email: null,
        sourceId: null,
        areaId: null,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data.email).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Ẩn danh hóa: PII còn sót trong audit', () => {
    it('mô tả tiêu chí (văn bản tự do) trong audit CRITERIA_UPDATED cũng phải bị ghi đè khi ẩn danh hóa', async () => {
      const c = await createCustomer('staffA', { fullName: 'Lê Bí Ẩn' });
      const detail = await call('GET', `/crm/customers/${c.id}`, 'staffA');
      const upd = await call(
        'PATCH',
        `/crm/customers/${c.id}/criteria`,
        'staffA',
        {
          version: detail.body.data.version,
          demand: {
            isDone: true,
            description: 'Khách Lê Bí Ẩn cần căn 2PN, lương 80tr, vợ tên Hoa',
          },
          finance: { description: 'Số tài khoản 9704xxxxxx của Lê Bí Ẩn' },
        },
      );
      expect(upd.status).toBe(200);
      const status2 = await call(
        'PATCH',
        `/crm/customers/${c.id}/status`,
        'staffA',
        {
          statusId: status.INTERESTED,
          version: upd.body.data.version,
          reason: 'Lê Bí Ẩn hẹn gặp thứ 7',
        },
      );
      expect(status2.status).toBe(200);
      expect(
        (
          await call('POST', '/crm/customer-anonymizations', 'admin', {
            customerId: c.id,
            reason: 'Yêu cầu của khách',
            confirm: true,
          })
        ).status,
      ).toBe(201);
      const auditJson = JSON.stringify(await auditOf(c.id));
      for (const secret of [
        'Lê Bí Ẩn',
        'lương 80tr',
        'vợ tên Hoa',
        '9704xxxxxx',
        'hẹn gặp thứ 7',
      ]) {
        expect([secret, auditJson.includes(secret)]).toEqual([secret, false]);
      }
    });

    it('ẩn danh hóa chỉ sửa audit của ĐÚNG khách đó (không đụng bản ghi khách khác hay audit không có customerId)', async () => {
      const a = await createCustomer('staffA', { fullName: 'Khách Một' });
      const b = await createCustomer('staffA', {
        fullName: 'Khách Hai Giữ Nguyên',
      });
      const adminAudit = await connection
        .collection('crm_audit_logs')
        .countDocuments({ customerId: null });
      await call('POST', '/crm/customer-anonymizations', 'admin', {
        customerId: a.id,
        reason: 'x',
        confirm: true,
      });
      expect(JSON.stringify(await auditOf(b.id))).toContain(
        'Khách Hai Giữ Nguyên',
      );
      expect(
        await connection
          .collection('crm_audit_logs')
          .countDocuments({ customerId: null }),
      ).toBe(adminAudit);
      // audit của khách đã ẩn danh vẫn còn đủ số bản ghi (không bị xóa)
      expect((await auditOf(a.id, 'CUSTOMER_CREATED')).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Tham số lạ ở histories / audit-logs / deleted-customers', () => {
    it('ObjectId/ngày/enum sai => 400, không bao giờ 500', async () => {
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
      });
      const urls = [
        `/crm/customers/${c.id}/histories?actorId=zzz`,
        `/crm/customers/${c.id}/histories?from=not-a-date`,
        `/crm/customers/${c.id}/histories?actions[$ne]=x`,
        `/crm/customers/${c.id}/histories?limit=1000`,
        '/crm/audit-logs?customerId=zzz',
        '/crm/audit-logs?actorId=zzz',
        '/crm/audit-logs?from=2026-13-45',
        '/crm/deleted-customers?deletedFrom=bad',
        '/crm/customers?statusIds=zzz',
        '/crm/customers?areaIds=zzz',
        '/crm/customers?progress=7',
        '/crm/customers?sort=-searchText',
        '/crm/customers?sort=nationalId',
        '/crm/customers?listGroup=CARING',
      ];
      for (const url of urls) {
        const res = await call('GET', url, 'admin');
        expect([url, res.status]).toEqual([url, 400]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Đồng bộ teamIds + mất quyền', () => {
    it('đổi nhóm người chăm sóc (nhiều khách) đồng bộ đúng cho khách xóa mềm; STAFF sau khi bị gỡ nhóm vẫn thấy khách của mình (theo careTeam) nhưng Quản lý nhóm cũ thì không', async () => {
      await createUser('movable', UserRole.STAFF);
      await call('PATCH', `/users/${ids.movable}/team`, 'admin', {
        teamId: ids.teamA,
      });
      const live = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.movable },
      });
      const gone = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.movable },
      });
      await call('DELETE', `/crm/customers/${gone.id}?reason=t`, 'admin');
      expect((await listIds('manager1')).includes(live.id)).toBe(true);
      expect(
        (
          await call('PATCH', `/users/${ids.movable}/team`, 'admin', {
            teamId: ids.teamB,
          })
        ).status,
      ).toBe(200);
      expect((await listIds('manager1')).includes(live.id)).toBe(false);
      expect((await listIds('manager2')).includes(live.id)).toBe(true);
      const goneDoc = await customers().findOne({
        _id: new Types.ObjectId(gone.id),
      });
      expect(goneDoc!.teamIds.map(String)).toEqual([ids.teamB]);
      expect((await listIds('movable')).includes(live.id)).toBe(true);
      // gỡ nhóm hoàn toàn => teamIds rỗng
      await call('PATCH', `/users/${ids.movable}/team`, 'admin', {
        teamId: null,
      });
      expect(
        (await customers().findOne({ _id: new Types.ObjectId(live.id) }))!
          .teamIds,
      ).toEqual([]);
    });
  });
});
