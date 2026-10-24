/**
 * INTEGRATION — CRM M4 (chân dung + thẻ) qua HTTP thật: Fastify + ValidationPipe + GlobalExceptionFilter +
 * JwtAuthGuard/RolesGuard + CrmFeatureGuard trên MongoDB Replica Set thật (mongodb-memory-server) và Redis THẬT
 * (idempotency + rate limit; `docker compose -f docker-compose.dev.yml up -d --wait`, key có tiền tố riêng mỗi lần chạy).
 * Kho ảnh thay bằng bản giả: M4 không dùng kho nhưng `CrmModule` cần provider `FILE_STORAGE`.
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
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import {
  FILE_STORAGE,
  IFileStorage,
} from '../../shared/storage/file-storage.interface';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { PII_AUDIT_FIELD_PATTERNS } from './customers/customer-lifecycle.service';
import { PersonaRecomputeService } from './persona/persona-recompute.service';
import { SEED_PERSONA_FIELDS } from './persona/persona-seed.data';
import { PersonaSeedService } from './persona/persona-seed.service';
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

/** Kho ảnh giả: M4 không ghi file. */
const unusedStorage = {
  isConfigured: () => false,
  checkHealth: () => Promise.resolve(),
} as unknown as IFileStorage;

describe('CRM M4 — chân dung và thẻ', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let recompute: PersonaRecomputeService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

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
    return { status: res.statusCode, body: parsed, headers: res.headers };
  };

  const createUser = async (key: string, role: UserRole) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

  let phoneSeq = 0;
  /** SĐT VN hợp lệ, duy nhất theo thứ tự gọi (đầu 093 để không đụng M2/M3). */
  const nextPhone = () => `093${String(1_000_000 + ++phoneSeq)}`;

  const createCustomer = async (
    as: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const phone = nextPhone();
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
      ...extra,
    });
    expect([res.status, res.body]).toEqual([201, expect.anything()]);
    return res.body.data.id;
  };

  const customerDoc = (id: string) =>
    connection.collection('customers').findOne({ _id: new Types.ObjectId(id) });
  const fieldDoc = (key: string) =>
    connection.collection('persona_fields').findOne({ key });
  const fieldId = async (key: string) => String((await fieldDoc(key))!._id);
  const tagDoc = (id: string) =>
    connection.collection('tags').findOne({ _id: new Types.ObjectId(id) });
  const auditOf = (customerId: string, action: string) =>
    connection
      .collection('crm_audit_logs')
      .find({ customerId: new Types.ObjectId(customerId), action })
      .sort({ _id: 1 })
      .toArray();

  /** `usageCount` của thẻ phải bằng số khách thật sự gắn thẻ (kể cả khách xóa mềm). */
  const expectUsageMatches = async (tagId: string) => {
    const attached = await connection
      .collection('customers')
      .countDocuments({ tagIds: new Types.ObjectId(tagId) });
    expect((await tagDoc(tagId))!.usageCount).toBe(attached);
  };

  const getPersona = (id: string, as: string | null) =>
    call('GET', `/crm/customers/${id}/persona`, as);

  /** PATCH chân dung với version hiện tại của khách (lấy từ GET persona) trừ khi truyền sẵn. */
  const patchPersona = async (
    id: string,
    as: string,
    values: unknown[],
    version?: number,
  ): Promise<Res> => {
    const current =
      version ?? (await getPersona(id, as)).body?.data?.version ?? 0;
    return call('PATCH', `/crm/customers/${id}/persona`, as, {
      version: current,
      values,
    });
  };

  const text = (fieldKey: string, valueText: string) => ({
    fieldKey,
    value: { valueText },
    source: 'STAFF_OBSERVED',
  });

  const fieldsOf = (res: Res): Record<string, any> =>
    Object.fromEntries(
      res.body.data.groups.flatMap((group: any) =>
        group.fields.map((field: any) => [field.fieldKey, field]),
      ),
    );

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-m4-${RUN_ID}:`;
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
    })
      .overrideProvider(FILE_STORAGE)
      .useValue(unusedStorage)
      .compile();

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
    recompute = app.get(PersonaRecomputeService);

    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();
    await app.get(PersonaSeedService).seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('manager2', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('staffD', UserRole.STAFF);

    ids.teamA = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm A',
        code: 'TEAMA',
        managerIds: [ids.manager1],
      })
    ).body.data.id;
    ids.teamB = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm B',
        code: 'TEAMB',
        managerIds: [ids.manager2],
      })
    ).body.data.id;
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
  describe('Seed trường chân dung', () => {
    it('có đủ nhóm + trường mẫu, nhóm REAL_ESTATE đủ 10 trường hệ thống, tất cả tùy chọn và không nhạy cảm', async () => {
      const groups = await connection
        .collection('catalog_items')
        .find({ type: 'PERSONA_GROUP' })
        .toArray();
      expect(groups.map((group) => group.code).sort()).toEqual(
        [
          'CONTACT',
          'FAMILY',
          'LIFESTYLE',
          'OCCASION',
          'OCCUPATION',
          'PERSONAL',
          'REAL_ESTATE',
        ].sort(),
      );
      const res = await call('GET', '/crm/persona-fields?limit=100', 'staffA');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(SEED_PERSONA_FIELDS.length);
      const realEstate = res.body.data.filter(
        (field: any) => field.groupCode === 'REAL_ESTATE',
      );
      expect(realEstate.map((field: any) => field.key)).toEqual([
        'property_type',
        'bedroom_type',
        'purchase_purposes',
        'budget',
        'equity_ratio',
        'loan_support',
        'expected_purchase_time',
        'criteria_priorities',
        'search_area',
        'specific_location',
      ]);
      expect(
        res.body.data.every(
          (field: any) => field.isSystem && !field.isSensitive,
        ),
      ).toBe(true);
      // Thứ tự trả về là thứ tự hiển thị.
      const orders = res.body.data.map((field: any) => field.order);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    });

    it('chạy lại seed không tạo trùng và không ghi đè chỉnh sửa của Quản trị', async () => {
      const salutation = await fieldId('salutation');
      expect(
        (
          await call('PATCH', `/crm/persona-fields/${salutation}`, 'admin', {
            label: 'Xưng hô (đã sửa)',
          })
        ).status,
      ).toBe(200);
      const before = await connection
        .collection('persona_fields')
        .countDocuments({});
      expect(await app.get(PersonaSeedService).seedAll()).toEqual({
        personaGroups: 0,
        personaFields: 0,
      });
      expect(
        await connection.collection('persona_fields').countDocuments({}),
      ).toBe(before);
      expect((await fieldDoc('salutation'))!.label).toBe('Xưng hô (đã sửa)');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Quyền: cấu hình trường chân dung và thẻ', () => {
    it('đọc: Quản trị/Quản lý/Nhân viên; Biên tập viên 403; không token 401', async () => {
      for (const url of ['/crm/persona-fields', '/crm/tags']) {
        for (const as of ['admin', 'manager1', 'staffA']) {
          expect([url, as, (await call('GET', url, as)).status]).toEqual([
            url,
            as,
            200,
          ]);
        }
        expect((await call('GET', url, 'editor')).status).toBe(403);
        expect((await call('GET', url, null)).status).toBe(401);
      }
    });

    it('ghi cấu hình trường: chỉ Quản trị (Quản lý, Nhân viên, Biên tập viên 403)', async () => {
      const salutation = await fieldId('salutation');
      for (const as of ['manager1', 'staffA', 'editor']) {
        const results = [
          await call('POST', '/crm/persona-fields', as, {
            key: 'khong_duoc',
            label: 'X',
            groupCode: 'PERSONAL',
            type: 'TEXT',
          }),
          await call('PATCH', `/crm/persona-fields/${salutation}`, as, {
            label: 'Y',
          }),
          await call('DELETE', `/crm/persona-fields/${salutation}`, as),
          await call('PUT', '/crm/persona-fields/order', as, {
            items: [{ id: salutation, order: 1 }],
          }),
        ];
        expect([as, results.map((res) => res.status)]).toEqual([
          as,
          [403, 403, 403, 403],
        ]);
      }
      expect((await fieldDoc('khong_duoc')) ?? null).toBeNull();
    });

    it('sửa/xóa/gộp thẻ: chỉ Quản trị; tạo thẻ: mọi vai trò CRM trừ Biên tập viên', async () => {
      const created = await call('POST', '/crm/tags', 'staffA', {
        name: 'Thẻ quyền',
        category: 'OTHER',
      });
      expect(created.status).toBe(201);
      const tagId = created.body.data.id;
      expect(
        (
          await call('POST', '/crm/tags', 'manager1', {
            name: 'Thẻ của quản lý',
            category: 'OTHER',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await call('POST', '/crm/tags', 'editor', {
            name: 'Thẻ biên tập',
            category: 'OTHER',
          })
        ).status,
      ).toBe(403);
      for (const as of ['manager1', 'staffA', 'editor']) {
        const results = [
          await call('PATCH', `/crm/tags/${tagId}`, as, { name: 'Đổi tên' }),
          await call('DELETE', `/crm/tags/${tagId}`, as),
        ];
        expect([as, results.map((res) => res.status)]).toEqual([
          as,
          [403, 403],
        ]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Cấu hình trường: tạo, kiểm hợp lệ, xóa, sắp xếp', () => {
    it('từ chối cấu hình sai: key sai dạng, trường chọn không có lựa chọn, dịp không phải DATE, lọc kiểu số, nhóm không có', async () => {
      const base = {
        key: 'truong_moi',
        label: 'Trường mới',
        groupCode: 'PERSONAL',
        type: 'TEXT',
      };
      const bad: Array<Record<string, unknown>> = [
        { ...base, key: 'Sai Dạng' },
        { ...base, key: '1abc' },
        { ...base, type: 'SELECT' },
        { ...base, type: 'SELECT', options: [] },
        { ...base, options: [{ value: 'A', label: 'A' }] },
        { ...base, isOccasion: true },
        { ...base, type: 'NUMBER', isFilterable: true },
        { ...base, groupCode: 'KHONG_CO' },
        {
          ...base,
          type: 'SELECT',
          options: [
            { value: 'A b', label: 'x' },
            { value: 'a_b', label: 'y' },
          ],
        },
        { ...base, weight: 101 },
        { ...base, type: 'KHAC' },
        { ...base, linhTinh: 1 },
      ];
      for (const body of bad) {
        const res = await call('POST', '/crm/persona-fields', 'admin', body);
        expect([JSON.stringify(body), res.status]).toEqual([
          JSON.stringify(body),
          400,
        ]);
      }
      expect((await fieldDoc('truong_moi')) ?? null).toBeNull();
    });

    it('tạo trường hợp lệ (201), trùng key (kể cả đã xóa) => 409 CATALOG_DUPLICATED, ghi audit', async () => {
      const res = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'pets',
        label: 'Thú cưng',
        groupCode: 'LIFESTYLE',
        type: 'SELECT',
        options: [
          { value: 'DOG', label: 'Chó' },
          { value: 'CAT', label: 'Mèo' },
        ],
        isFilterable: true,
        weight: 2,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        key: 'pets',
        type: 'SELECT',
        weight: 2,
        isSystem: false,
        isActive: true,
        options: [
          { value: 'DOG', label: 'Chó', isActive: true },
          { value: 'CAT', label: 'Mèo', isActive: true },
        ],
      });
      ids.petsField = res.body.data.id;

      const again = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'pets',
        label: 'Trùng',
        groupCode: 'LIFESTYLE',
        type: 'TEXT',
      });
      expect([again.status, again.body.errorCode]).toEqual([
        409,
        'CATALOG_DUPLICATED',
      ]);
      expect(
        await connection.collection('crm_audit_logs').countDocuments({
          action: 'PERSONA_FIELD_CREATED',
          entityId: new Types.ObjectId(ids.petsField),
        }),
      ).toBe(1);
    });

    it('trường hệ thống không xóa được (409 PERSONA_FIELD_SYSTEM); trường thường xóa mềm, ẩn khỏi danh sách, key vẫn bị giữ chỗ', async () => {
      const system = await call(
        'DELETE',
        `/crm/persona-fields/${await fieldId('budget')}`,
        'admin',
      );
      expect([system.status, system.body.errorCode]).toEqual([
        409,
        'PERSONA_FIELD_SYSTEM',
      ]);
      expect(system.body.details).toEqual({ valueCount: 0 });

      const created = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'tam_thoi',
        label: 'Tạm thời',
        groupCode: 'PERSONAL',
        type: 'TEXT',
      });
      const removed = await call(
        'DELETE',
        `/crm/persona-fields/${created.body.data.id}`,
        'admin',
      );
      expect(removed.status).toBe(204);
      const list = await call('GET', '/crm/persona-fields?limit=100', 'admin');
      expect(list.body.data.map((field: any) => field.key)).not.toContain(
        'tam_thoi',
      );
      const recreate = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'tam_thoi',
        label: 'Tạm thời 2',
        groupCode: 'PERSONAL',
        type: 'NUMBER',
      });
      expect(recreate.status).toBe(409);
      const second = await call(
        'DELETE',
        `/crm/persona-fields/${created.body.data.id}`,
        'admin',
      );
      expect(second.status).toBe(404);
    });

    it('sắp lại thứ tự và chuyển nhóm; id không tồn tại 404, id trùng 400', async () => {
      const hobbies = await fieldId('hobbies');
      const lifestyle = await fieldId('lifestyle');
      const before = await call(
        'GET',
        '/crm/persona-fields?limit=100',
        'admin',
      );
      const maxOrder = Math.max(
        ...before.body.data.map((field: any) => field.order),
      );

      const res = await call('PUT', '/crm/persona-fields/order', 'admin', {
        items: [
          { id: hobbies, order: maxOrder + 2 },
          { id: lifestyle, order: maxOrder + 1, groupCode: 'FAMILY' },
        ],
      });
      expect(res.status).toBe(200);
      const keys = res.body.data.map((field: any) => field.key);
      expect(keys.indexOf('lifestyle')).toBeLessThan(keys.indexOf('hobbies'));
      expect(
        res.body.data.find((field: any) => field.key === 'lifestyle').groupCode,
      ).toBe('FAMILY');

      for (const [items, expected] of [
        [[{ id: String(new Types.ObjectId()), order: 1 }], 404],
        [
          [
            { id: hobbies, order: 1 },
            { id: hobbies, order: 2 },
          ],
          400,
        ],
        [[{ id: hobbies, order: 1, groupCode: 'KHONG_CO' }], 400],
        [[], 400],
      ] as const) {
        const bad = await call('PUT', '/crm/persona-fields/order', 'admin', {
          items,
        });
        expect([JSON.stringify(items), bad.status]).toEqual([
          JSON.stringify(items),
          expected,
        ]);
      }
      // Trả lại vị trí cũ để các test sau không phụ thuộc.
      await call('PUT', '/crm/persona-fields/order', 'admin', {
        items: [{ id: lifestyle, order: maxOrder + 3, groupCode: 'LIFESTYLE' }],
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Chân dung của khách: phạm vi, kiểm hợp lệ, độ đầy đủ, audit', () => {
    let cA: string;

    it('GET: người trong nhóm chăm sóc, Quản lý nhóm, Quản trị xem được; người ngoài phạm vi 404; Biên tập viên 403', async () => {
      cA = await createCustomer('staffA');
      ids.cA = cA;

      for (const as of ['staffA', 'manager1', 'admin']) {
        const res = await getPersona(cA, as);
        expect([as, res.status]).toEqual([as, 200]);
      }
      for (const as of ['staffB', 'staffC', 'manager2']) {
        const res = await getPersona(cA, as);
        expect([as, res.status, res.body.errorCode]).toEqual([
          as,
          404,
          'CUSTOMER_NOT_FOUND',
        ]);
      }
      expect((await getPersona(cA, 'editor')).status).toBe(403);
      expect((await getPersona(cA, null)).status).toBe(401);

      const res = await getPersona(cA, 'staffA');
      expect(res.body.data.completeness).toBe(0);
      expect(res.body.data.missingSuggestions).toHaveLength(5);
      // Gợi ý ưu tiên suggestPriority nhỏ: occupation(5) -> budget(7) -> property_type(8) -> purchase_purposes(9) -> birthday(10)
      expect(
        res.body.data.missingSuggestions.map((item: any) => item.fieldKey),
      ).toEqual([
        'occupation',
        'budget',
        'property_type',
        'purchase_purposes',
        'birthday',
      ]);
      const groupCodes = res.body.data.groups.map((group: any) => group.code);
      expect(groupCodes[0]).toBe('PERSONAL');
      expect(groupCodes).toContain('REAL_ESTATE');
    });

    it('PATCH: lưu nhiều kiểu giá trị, ghi người/ngày/nguồn, tăng version, tính độ đầy đủ và dịp đặc biệt', async () => {
      const res = await patchPersona(cA, 'staffA', [
        text('occupation', '  Kế toán trưởng '),
        {
          fieldKey: 'birthday',
          value: { valueDate: '1990-05-17' },
          source: 'CUSTOMER_SHARED',
        },
        {
          fieldKey: 'property_type',
          value: { valueOptions: ['APARTMENT'] },
          source: 'CUSTOMER_SHARED',
        },
        {
          fieldKey: 'purchase_purposes',
          value: { valueOptions: ['LIVING', 'INVEST_RENT'] },
          source: 'STAFF_OBSERVED',
        },
        {
          fieldKey: 'budget',
          value: { valueNumber: 3_000_000_000, valueNumberTo: 4_500_000_000 },
          source: 'CUSTOMER_SHARED',
        },
        {
          fieldKey: 'loan_support',
          value: { valueBoolean: false },
          source: 'CUSTOMER_SHARED',
        },
      ]);
      expect([res.status, res.body.message]).toEqual([200, undefined]);
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.updated).toHaveLength(6);
      const totalWeight = (
        await call(
          'GET',
          '/crm/persona-fields?isActive=true&limit=100',
          'admin',
        )
      ).body.data.reduce((sum: number, field: any) => sum + field.weight, 0);
      expect(res.body.data.completeness).toBe(
        Math.round((6 / totalWeight) * 100),
      );

      const view = fieldsOf(await getPersona(cA, 'staffA'));
      expect(view.occupation).toMatchObject({
        value: { valueText: 'Kế toán trưởng' },
        source: 'STAFF_OBSERVED',
        updatedBy: { id: ids.staffA, displayName: 'staffA' },
      });
      expect(view.occupation.updatedAt).toEqual(expect.any(String));
      expect(view.budget.value).toEqual({
        valueNumber: 3_000_000_000,
        valueNumberTo: 4_500_000_000,
      });
      expect(view.loan_support.value).toEqual({ valueBoolean: false });
      expect(view.hometown.value).toBeNull();

      const doc = await customerDoc(cA);
      expect(doc!.persona).toHaveLength(6);
      expect(doc!.personaCompleteness).toBe(res.body.data.completeness);
      expect(doc!.occasions).toEqual([
        { fieldKey: 'birthday', month: 5, day: 17, year: 1990 },
      ]);
      // token lọc: chỉ trường isFilterable (occupation, property_type, purchase_purposes)
      expect([...(doc!.personaFilterKeys as string[])].sort()).toEqual([
        'occupation=ke_toan_truong',
        'property_type=apartment',
        'purchase_purposes=invest_rent',
        'purchase_purposes=living',
      ]);
      // list và detail cũng thấy độ đầy đủ (không lộ giá trị chân dung)
      const detail = await call('GET', `/crm/customers/${cA}`, 'staffA');
      expect(detail.body.data.personaCompleteness).toBe(
        res.body.data.completeness,
      );
      expect(JSON.stringify(detail.body)).not.toContain('Kế toán trưởng');
      expect(detail.body.data.version).toBe(1);
    });

    it('từ chối giá trị sai kiểu/lựa chọn/ngày/trường không có/khóa thừa bằng PERSONA_VALUE_INVALID (không ghi gì)', async () => {
      const before = await customerDoc(cA);
      const cases: Array<[string, unknown]> = [
        ['occupation', { valueNumber: 1 }],
        ['occupation', { valueText: '   ' }],
        ['property_type', { valueOptions: ['KHONG_CO'] }],
        ['property_type', { valueOptions: ['VILLA', 'LAND'] }],
        ['birthday', { valueDate: '2026-02-30' }],
        ['budget', { valueNumber: 9, valueNumberTo: 1 }],
        ['khong_ton_tai', { valueText: 'x' }],
      ];
      for (const [fieldKey, value] of cases) {
        const res = await patchPersona(cA, 'staffA', [
          { fieldKey, value, source: 'STAFF_OBSERVED' },
        ]);
        expect([fieldKey, JSON.stringify(value), res.status]).toEqual([
          fieldKey,
          JSON.stringify(value),
          400,
        ]);
        expect(res.body.errorCode).toBe('PERSONA_VALUE_INVALID');
        expect(res.body.details).toEqual({ fieldKey });
      }
      // Một giá trị sai làm hỏng cả lô: giá trị đúng đi kèm không được ghi.
      const mixed = await patchPersona(cA, 'staffA', [
        text('hometown', 'Nghệ An'),
        {
          fieldKey: 'birthday',
          value: { valueDate: 'khong-phai-ngay' },
          source: 'STAFF_OBSERVED',
        },
      ]);
      expect(mixed.status).toBe(400);
      const after = await customerDoc(cA);
      expect(after!.persona).toEqual(before!.persona);
      expect(after!.__v).toBe(before!.__v);
    });

    it('kiểm DTO: thiếu version/values, source IMPORTED, trùng fieldKey, quá 50 mục => 400', async () => {
      const url = `/crm/customers/${cA}/persona`;
      const ok = text('hometown', 'Hà Nội');
      for (const body of [
        { values: [ok] },
        { version: 1 },
        { version: 1, values: [] },
        { version: 1, values: [{ ...ok, source: 'IMPORTED' }] },
        { version: 1, values: [ok, ok] },
        {
          version: 1,
          values: Array.from({ length: 51 }, (_, i) => text(`f${i}`, 'x')),
        },
        {
          version: 1,
          values: [{ fieldKey: 'hometown', source: 'STAFF_OBSERVED' }],
        },
        {
          version: 1,
          values: [
            {
              fieldKey: 'loan_support',
              value: { valueBoolean: 'yes' },
              source: 'STAFF_OBSERVED',
            },
          ],
        },
      ]) {
        expect([
          JSON.stringify(body).slice(0, 80),
          (await call('PATCH', url, 'staffA', body)).status,
        ]).toEqual([JSON.stringify(body).slice(0, 80), 400]);
      }
    });

    it('khóa lạc quan: version cũ => 409 VERSION_CONFLICT; ghi chân dung làm khách phải tải lại trước khi PATCH hồ sơ', async () => {
      const stale = await patchPersona(
        cA,
        'staffA',
        [text('hometown', 'Huế')],
        0,
      );
      expect([stale.status, stale.body.errorCode]).toEqual([
        409,
        'VERSION_CONFLICT',
      ]);
      expect(stale.body.details).toEqual({ currentVersion: 1 });

      const profileStale = await call(
        'PATCH',
        `/crm/customers/${cA}`,
        'staffA',
        {
          version: 0,
          fullName: 'Tên mới',
        },
      );
      expect(profileStale.status).toBe(409);
    });

    it('ghi lại đúng giá trị cũ là no-op: không tăng version, không audit; đổi nguồn thì ghi', async () => {
      const auditBefore = (await auditOf(cA, 'PERSONA_UPDATED')).length;
      const same = await patchPersona(cA, 'staffA', [
        text('occupation', 'Kế toán trưởng'),
      ]);
      expect(same.status).toBe(200);
      expect(same.body.data.updated).toEqual([]);
      expect(same.body.data.version).toBe(1);
      expect((await auditOf(cA, 'PERSONA_UPDATED')).length).toBe(auditBefore);

      const sourceChanged = await patchPersona(cA, 'staffA', [
        {
          fieldKey: 'occupation',
          value: { valueText: 'Kế toán trưởng' },
          source: 'CUSTOMER_SHARED',
        },
      ]);
      expect(sourceChanged.body.data.updated).toHaveLength(1);
      expect(sourceChanged.body.data.version).toBe(2);
    });

    it('người ngoài phạm vi PATCH => 404 và không ghi; Quản lý nhóm khác 404; Quản lý nhóm A và Quản trị được ghi', async () => {
      const before = await customerDoc(cA);
      for (const as of ['staffB', 'staffC', 'manager2']) {
        const res = await patchPersona(
          cA,
          as,
          [text('hometown', 'Lén ghi')],
          2,
        );
        expect([as, res.status, res.body.errorCode]).toEqual([
          as,
          404,
          'CUSTOMER_NOT_FOUND',
        ]);
      }
      expect((await customerDoc(cA))!.persona).toEqual(before!.persona);
      expect(
        (await patchPersona(cA, 'manager1', [text('hometown', 'Huế')], 2))
          .status,
      ).toBe(200);
      expect(
        (await patchPersona(cA, 'admin', [text('salutation', 'Anh An')], 3))
          .status,
      ).toBe(200);
    });

    it('xóa giá trị bằng value null; xóa trường chưa có giá trị là no-op; độ đầy đủ giảm', async () => {
      const before = (await getPersona(cA, 'staffA')).body.data;
      const res = await patchPersona(cA, 'staffA', [
        { fieldKey: 'hometown', value: null, source: 'STAFF_OBSERVED' },
        { fieldKey: 'children', value: null, source: 'STAFF_OBSERVED' },
      ]);
      expect(res.status).toBe(200);
      expect(res.body.data.updated).toEqual([
        expect.objectContaining({
          fieldKey: 'hometown',
          value: null,
          source: null,
        }),
      ]);
      expect(res.body.data.completeness).toBeLessThan(before.completeness);
      expect(
        (await customerDoc(cA))!.persona.map((item: any) => item.fieldKey),
      ).not.toContain('hometown');
    });

    it('trường nhạy cảm: cần source=CUSTOMER_SHARED VÀ sensitiveAcknowledged=true; audit không ghi giá trị', async () => {
      const created = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'health_note',
        label: 'Ghi chú nhạy cảm',
        groupCode: 'PERSONAL',
        type: 'TEXT',
        isSensitive: true,
      });
      expect(created.status).toBe(201);
      const attempt = (extra: Record<string, unknown>, source: string) =>
        patchPersona(cA, 'staffA', [
          {
            fieldKey: 'health_note',
            value: { valueText: 'điều rất riêng tư' },
            source,
            ...extra,
          },
        ]);
      for (const res of [
        await attempt({}, 'STAFF_OBSERVED'),
        await attempt({ sensitiveAcknowledged: true }, 'STAFF_OBSERVED'),
        await attempt({}, 'CUSTOMER_SHARED'),
        await attempt({ sensitiveAcknowledged: false }, 'CUSTOMER_SHARED'),
      ]) {
        expect([res.status, res.body.errorCode]).toEqual([
          400,
          'SENSITIVE_FIELD_CONSENT_REQUIRED',
        ]);
        expect(res.body.details).toEqual({ fieldKey: 'health_note' });
      }
      const ok = await attempt(
        { sensitiveAcknowledged: true },
        'CUSTOMER_SHARED',
      );
      expect(ok.status).toBe(200);

      const entries = await auditOf(cA, 'PERSONA_UPDATED');
      const serialized = JSON.stringify(entries);
      expect(serialized).not.toContain('điều rất riêng tư');
      expect(serialized).toContain('[nhạy cảm]');
      // Xóa giá trị nhạy cảm không cần xác nhận (quyền xóa dữ liệu cá nhân).
      const cleared = await patchPersona(cA, 'staffA', [
        { fieldKey: 'health_note', value: null, source: 'STAFF_OBSERVED' },
      ]);
      expect(cleared.status).toBe(200);
    });

    it('lịch sử khách có PERSONA_UPDATED theo persona.<fieldKey> (người xem được khách thấy được)', async () => {
      const res = await call(
        'GET',
        `/crm/customers/${cA}/histories?actions=PERSONA_UPDATED&limit=50`,
        'staffA',
      );
      expect(res.status).toBe(200);
      const changes = res.body.data.flatMap((entry: any) => entry.changes);
      const occupation = changes.filter(
        (change: any) => change.field === 'persona.occupation',
      );
      // Lịch sử mới nhất trước: [đổi nguồn, lần nhập đầu].
      expect(occupation).toEqual([
        {
          field: 'persona.occupation',
          from: { value: 'Kế toán trưởng', source: 'STAFF_OBSERVED' },
          to: { value: 'Kế toán trưởng', source: 'CUSTOMER_SHARED' },
        },
        {
          field: 'persona.occupation',
          from: null,
          to: { value: 'Kế toán trưởng', source: 'STAFF_OBSERVED' },
        },
      ]);
    });

    it('GET/PATCH chân dung của khách đã xóa mềm => 404 và không ghi gì', async () => {
      const gone = await createCustomer('staffA');
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${gone}?reason=thu%20nghiem`,
            'admin',
          )
        ).status,
      ).toBe(204);
      for (const as of ['admin', 'staffA']) {
        const patch = await patchPersona(gone, as, [text('hometown', 'x')], 0);
        expect([as, patch.status, patch.body.errorCode]).toEqual([
          as,
          404,
          'CUSTOMER_NOT_FOUND',
        ]);
        expect((await getPersona(gone, as)).status).toBe(404);
      }
      expect((await customerDoc(gone))!.persona).toEqual([]);
    });

    it('trường nhạy cảm không tính vào độ đầy đủ và không được gợi ý hỏi (dù ưu tiên cao nhất)', async () => {
      const customer = await createCustomer('staffA');
      const before = (await getPersona(customer, 'staffA')).body.data;
      const created = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'sens_prio',
        label: 'Rất nhạy cảm',
        groupCode: 'PERSONAL',
        type: 'TEXT',
        isSensitive: true,
        weight: 50,
        suggestPriority: 0,
      });
      expect(created.status).toBe(201);
      const after = (await getPersona(customer, 'staffA')).body.data;
      expect(after.completeness).toBe(before.completeness);
      const keys = (data: any) =>
        data.missingSuggestions.map((item: any) => item.fieldKey);
      expect(keys(after)).toEqual(keys(before));
      expect(keys(after)).not.toContain('sens_prio');

      // Có giá trị nhạy cảm cũng không làm độ đầy đủ tăng.
      const set = await patchPersona(customer, 'staffA', [
        {
          fieldKey: 'sens_prio',
          value: { valueText: 'x' },
          source: 'CUSTOMER_SHARED',
          sensitiveAcknowledged: true,
        },
      ]);
      expect([set.status, set.body.data.completeness]).toEqual([200, 0]);
      await recompute.run();
      expect((await customerDoc(customer))!.personaCompleteness).toBe(0);
    });

    it('PATCH không bật được isFilterable trên trường nhạy cảm, cũng không bật isSensitive trên trường lọc được', async () => {
      const onSensitive = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('health_note')}`,
        'admin',
        { isFilterable: true },
      );
      const onFilterable = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('occupation')}`,
        'admin',
        { isSensitive: true },
      );
      expect([onSensitive.status, onFilterable.status]).toEqual([400, 400]);
      expect((await fieldDoc('health_note'))!.isFilterable).toBe(false);
      expect((await fieldDoc('occupation'))!.isSensitive).toBe(false);
    });

    it('xóa giá trị chân dung ghi đè giá trị trong audit CŨ của đúng trường đó (quyền xóa dữ liệu cá nhân)', async () => {
      const customer = await createCustomer('staffA');
      await patchPersona(customer, 'staffA', [
        text('hometown', 'Giá trị cũ A'),
        text('children', 'Giữ nguyên con'),
      ]);
      await patchPersona(customer, 'staffA', [
        text('hometown', 'Giá trị cũ B'),
      ]);
      const erased = await patchPersona(customer, 'staffA', [
        { fieldKey: 'hometown', value: null, source: 'STAFF_OBSERVED' },
      ]);
      expect(erased.status).toBe(200);

      const entries = await auditOf(customer, 'PERSONA_UPDATED');
      expect(entries).toHaveLength(3);
      const serialized = JSON.stringify(entries);
      expect(serialized).not.toContain('Giá trị cũ A');
      expect(serialized).not.toContain('Giá trị cũ B');
      // Trường khác của cùng khách không bị đụng.
      expect(serialized).toContain('Giữ nguyên con');
      const hometown = entries
        .flatMap((entry) => entry.changes as any[])
        .filter((change) => change.field === 'persona.hometown');
      expect(hometown).toHaveLength(3);
      for (const change of hometown) {
        for (const side of [change.from, change.to]) {
          expect(side === null || side.value === '[đã xóa]').toBe(true);
        }
      }
      expect(hometown[0].to).toEqual({
        value: '[đã xóa]',
        source: 'STAFF_OBSERVED',
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Đổi cấu hình trường KHÔNG làm mất dữ liệu cũ (tiêu chí xong của M4)', () => {
    let cX: string;
    let cY: string;

    const dbPersona = async (id: string) =>
      ((await customerDoc(id))!.persona as any[]).map((item) => item.fieldKey);

    beforeAll(async () => {
      cX = await createCustomer('staffA');
      cY = await createCustomer('staffA');
      for (const id of [cX, cY]) {
        const res = await patchPersona(id, 'staffA', [
          text('occupation', 'Giáo viên'),
          text('hometown', 'Quảng Bình'),
          {
            fieldKey: 'property_type',
            value: { valueOptions: ['VILLA'] },
            source: 'CUSTOMER_SHARED',
          },
          {
            fieldKey: 'purchase_purposes',
            value: { valueOptions: ['LIVING', 'FOR_CHILD'] },
            source: 'CUSTOMER_SHARED',
          },
        ]);
        expect(res.status).toBe(200);
      }
    });

    it('tắt trường: ẩn khỏi chân dung và không tính độ đầy đủ, nhưng giá trị vẫn nằm trong DB; bật lại thì hiện lại nguyên vẹn', async () => {
      const before = await getPersona(cX, 'staffA');
      const hometownBefore = fieldsOf(before).hometown;
      expect(hometownBefore.value).toEqual({ valueText: 'Quảng Bình' });

      const off = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('hometown')}`,
        'admin',
        { isActive: false },
      );
      expect(off.status).toBe(200);
      await recompute.run();

      const hidden = await getPersona(cX, 'staffA');
      expect(fieldsOf(hidden).hometown).toBeUndefined();
      expect(hidden.body.data.completeness).toBeLessThan(
        before.body.data.completeness,
      );
      expect(await dbPersona(cX)).toContain('hometown');
      // job nền đã tính lại độ đầy đủ đã lưu cho MỌI khách có chân dung
      expect((await customerDoc(cX))!.personaCompleteness).toBe(
        hidden.body.data.completeness,
      );
      expect((await customerDoc(cX))!.personaConfigVersion).toBe(
        (await connection
          .collection('persona_config_state')
          .findOne({ _id: 'PERSONA_CONFIG' as never }))!.version,
      );
      // Không nhập được giá trị cho trường đang tắt, nhưng xóa thì được.
      const write = await patchPersona(cX, 'staffA', [
        text('hometown', 'Đà Nẵng'),
      ]);
      expect([write.status, write.body.errorCode]).toEqual([
        400,
        'PERSONA_VALUE_INVALID',
      ]);

      const on = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('hometown')}`,
        'admin',
        { isActive: true },
      );
      expect(on.status).toBe(200);
      await recompute.run();
      const back = await getPersona(cX, 'staffA');
      expect(fieldsOf(back).hometown).toEqual(hometownBefore);
      expect(back.body.data.completeness).toBe(before.body.data.completeness);
    });

    it('xóa mềm trường đã có dữ liệu: dữ liệu khách vẫn còn trong DB; không nhập mới nhưng vẫn xóa được giá trị', async () => {
      const created = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'so_thich_xe',
        label: 'Xe yêu thích',
        groupCode: 'LIFESTYLE',
        type: 'TEXT',
      });
      expect(created.status).toBe(201);
      expect(
        (await patchPersona(cX, 'staffA', [text('so_thich_xe', 'Mazda')]))
          .status,
      ).toBe(200);

      const removed = await call(
        'DELETE',
        `/crm/persona-fields/${created.body.data.id}`,
        'admin',
      );
      expect(removed.status).toBe(204);
      await recompute.run();
      expect(
        fieldsOf(await getPersona(cX, 'staffA')).so_thich_xe,
      ).toBeUndefined();
      expect(await dbPersona(cX)).toContain('so_thich_xe');

      // Trường đã xóa mềm: không nhập mới được, nhưng xóa giá trị đã có thì được (quyền xóa dữ liệu cá nhân).
      const write = await patchPersona(cX, 'staffA', [
        text('so_thich_xe', 'Kia'),
      ]);
      expect([write.status, write.body.errorCode]).toEqual([
        400,
        'PERSONA_VALUE_INVALID',
      ]);
      const clear = await patchPersona(cX, 'staffA', [
        { fieldKey: 'so_thich_xe', value: null, source: 'STAFF_OBSERVED' },
      ]);
      expect(clear.status).toBe(200);
      expect(await dbPersona(cX)).not.toContain('so_thich_xe');
    });

    it('bớt lựa chọn = tắt lựa chọn: giá trị khách đã chọn vẫn đọc và lưu lại được; khách khác không chọn được lựa chọn đã tắt', async () => {
      const propertyType = await fieldId('property_type');
      const current = (await fieldDoc('property_type'))!.options as any[];
      const desired = current
        .filter((option) => option.value !== 'VILLA')
        .map((option) => ({ value: option.value, label: option.label }));
      const res = await call(
        'PATCH',
        `/crm/persona-fields/${propertyType}`,
        'admin',
        {
          options: desired,
        },
      );
      expect(res.status).toBe(200);
      expect(
        res.body.data.options.find((o: any) => o.value === 'VILLA'),
      ).toEqual({
        value: 'VILLA',
        label: 'Biệt thự / Villa',
        isActive: false,
      });
      expect(res.body.data.options).toHaveLength(current.length);

      const view = fieldsOf(await getPersona(cX, 'staffA'));
      expect(view.property_type.value).toEqual({ valueOptions: ['VILLA'] });
      // Lưu lại đúng lựa chọn cũ khi sửa trường khác vẫn hợp lệ.
      const resave = await patchPersona(cX, 'staffA', [
        {
          fieldKey: 'property_type',
          value: { valueOptions: ['VILLA'] },
          source: 'STAFF_OBSERVED',
        },
      ]);
      expect(resave.status).toBe(200);
      const cNew = await createCustomer('staffA');
      const pick = await patchPersona(cNew, 'staffA', [
        {
          fieldKey: 'property_type',
          value: { valueOptions: ['VILLA'] },
          source: 'STAFF_OBSERVED',
        },
      ]);
      expect([pick.status, pick.body.errorCode]).toEqual([
        400,
        'PERSONA_VALUE_INVALID',
      ]);
      // Bật lại lựa chọn
      const reenable = await call(
        'PATCH',
        `/crm/persona-fields/${propertyType}`,
        'admin',
        {
          options: [
            ...desired,
            { value: 'VILLA', label: 'Biệt thự / Villa', isActive: true },
          ],
        },
      );
      expect(
        reenable.body.data.options.find((o: any) => o.value === 'VILLA')
          .isActive,
      ).toBe(true);
    });

    it('đổi nhãn/trọng số/lọc: dữ liệu nguyên vẹn, job nền tính lại độ đầy đủ và token lọc cho mọi khách', async () => {
      const occupation = await fieldId('occupation');
      const tokensBefore = (await customerDoc(cY))!
        .personaFilterKeys as string[];
      expect(tokensBefore).toContain('occupation=giao_vien');

      expect(
        (
          await call('PATCH', `/crm/persona-fields/${occupation}`, 'admin', {
            label: 'Nghề (đổi nhãn)',
            weight: 10,
            isFilterable: false,
          })
        ).status,
      ).toBe(200);
      await recompute.run();

      const afterOff = await customerDoc(cY);
      expect(afterOff!.personaFilterKeys).not.toContain('occupation=giao_vien');
      expect(await dbPersona(cY)).toContain('occupation');
      const view = fieldsOf(await getPersona(cY, 'staffA'));
      expect(view.occupation).toMatchObject({
        label: 'Nghề (đổi nhãn)',
        value: { valueText: 'Giáo viên' },
      });
      // weight 10 làm độ đầy đủ đã lưu thay đổi và khớp giá trị tính trực tiếp
      expect(afterOff!.personaCompleteness).toBe(
        (await getPersona(cY, 'staffA')).body.data.completeness,
      );

      await call('PATCH', `/crm/persona-fields/${occupation}`, 'admin', {
        weight: 1,
        isFilterable: true,
      });
      await recompute.run();
      expect((await customerDoc(cY))!.personaFilterKeys).toContain(
        'occupation=giao_vien',
      );
    });

    it('đổi kiểu: bị khóa (409 PERSONA_FIELD_TYPE_LOCKED kèm valueCount) khi đã có dữ liệu; đổi được khi chưa có', async () => {
      const locked = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('occupation')}`,
        'admin',
        { type: 'TEXTAREA' },
      );
      expect([locked.status, locked.body.errorCode]).toEqual([
        409,
        'PERSONA_FIELD_TYPE_LOCKED',
      ]);
      expect(locked.body.details.valueCount).toBeGreaterThanOrEqual(2);
      expect((await fieldDoc('occupation'))!.type).toBe('TEXT');

      const empty = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'chua_co_du_lieu',
        label: 'Chưa có dữ liệu',
        groupCode: 'PERSONAL',
        type: 'TEXT',
      });
      const changed = await call(
        'PATCH',
        `/crm/persona-fields/${empty.body.data.id}`,
        'admin',
        { type: 'NUMBER' },
      );
      expect([changed.status, changed.body.data?.type]).toEqual([
        200,
        'NUMBER',
      ]);
      // Đổi sang kiểu chọn mà thiếu lựa chọn => 400
      const noOptions = await call(
        'PATCH',
        `/crm/persona-fields/${empty.body.data.id}`,
        'admin',
        { type: 'SELECT' },
      );
      expect(noOptions.status).toBe(400);
    });

    it('job tự nhặt phần dở sau khi khởi động lại: khách có dấu phiên bản cũ được tính lại', async () => {
      const untouched = (await customerDoc(cY))!;
      await connection.collection('customers').updateOne(
        { _id: new Types.ObjectId(cY) },
        {
          $set: {
            personaCompleteness: 99,
            personaFilterKeys: [],
            personaConfigVersion: -1,
          },
        },
      );
      const updated = await recompute.run();
      expect(updated).toBeGreaterThanOrEqual(1);
      const fixed = await customerDoc(cY);
      expect(fixed!.personaCompleteness).toBe(
        (await getPersona(cY, 'staffA')).body.data.completeness,
      );
      expect(fixed!.personaFilterKeys).toContain('occupation=giao_vien');
      // Job không đụng version/ngày cập nhật: người đang sửa hồ sơ không dính VERSION_CONFLICT.
      expect(fixed!.__v).toBe(untouched.__v);
      expect(fixed!.lastUpdatedAt).toEqual(untouched.lastUpdatedAt);
      expect(fixed!.persona).toEqual(untouched.persona);
    });

    it('đổi kiểu trường đồng thời với ghi giá trị: không bao giờ có dữ liệu sai kiểu (khóa refLock)', async () => {
      for (let round = 0; round < 3; round += 1) {
        const key = `dua_${round}`;
        const created = await call('POST', '/crm/persona-fields', 'admin', {
          key,
          label: key,
          groupCode: 'PERSONAL',
          type: 'TEXT',
        });
        const customer = await createCustomer('staffA');
        const version = (await getPersona(customer, 'staffA')).body.data
          .version;
        const [typeChange, write] = await Promise.all([
          call(
            'PATCH',
            `/crm/persona-fields/${created.body.data.id}`,
            'admin',
            {
              type: 'NUMBER',
            },
          ),
          patchPersona(customer, 'staffA', [text(key, 'chữ')], version),
        ]);
        const type = (await fieldDoc(key))!.type;
        const stored = ((await customerDoc(customer))!.persona as any[]).find(
          (item) => item.fieldKey === key,
        );
        if (type === 'NUMBER') {
          expect([typeChange.status, write.status]).toEqual([200, 400]);
          expect(stored).toBeUndefined();
        } else {
          expect([typeChange.status, write.status]).toEqual([409, 200]);
          expect(stored.valueText).toBe('chữ');
        }
      }
    });

    it('khóa đổi kiểu tính cả giá trị của khách đã xóa mềm (khôi phục vẫn cần dữ liệu)', async () => {
      const created = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'khoa_xoa_mem',
        label: 'Khóa xóa mềm',
        groupCode: 'PERSONAL',
        type: 'TEXT',
      });
      const customer = await createCustomer('staffA');
      expect(
        (await patchPersona(customer, 'staffA', [text('khoa_xoa_mem', 'x')]))
          .status,
      ).toBe(200);
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${customer}?reason=thu%20nghiem`,
            'admin',
          )
        ).status,
      ).toBe(204);
      const locked = await call(
        'PATCH',
        `/crm/persona-fields/${created.body.data.id}`,
        'admin',
        { type: 'NUMBER' },
      );
      expect([
        locked.status,
        locked.body.errorCode,
        locked.body.details,
      ]).toEqual([409, 'PERSONA_FIELD_TYPE_LOCKED', { valueCount: 1 }]);
    });

    it('đổi trường sang nhạy cảm (PATCH isSensitive + bỏ isFilterable) dọn token lọc của khách cũ; trường dữ liệu cũ nhạy cảm + lọc được vẫn tắt được (không 400)', async () => {
      const created = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'doi_nhay_cam',
        label: 'Đổi nhạy cảm',
        groupCode: 'PERSONAL',
        type: 'TEXT',
        isFilterable: true,
      });
      expect(created.status).toBe(201);
      const customer = await createCustomer('staffA');
      expect(
        (
          await patchPersona(customer, 'staffA', [
            text('doi_nhay_cam', 'Giá trị'),
          ])
        ).status,
      ).toBe(200);
      expect((await customerDoc(customer))!.personaFilterKeys).toContain(
        'doi_nhay_cam=gia_tri',
      );

      // Chỉ đổi isSensitive khi vẫn lọc được là sai hình dạng (nhạy cảm không được lọc): 400.
      expect(
        (
          await call(
            'PATCH',
            `/crm/persona-fields/${created.body.data.id}`,
            'admin',
            { isSensitive: true },
          )
        ).status,
      ).toBe(400);
      const patched = await call(
        'PATCH',
        `/crm/persona-fields/${created.body.data.id}`,
        'admin',
        { isSensitive: true, isFilterable: false },
      );
      expect(patched.status).toBe(200);
      await recompute.run();
      const after = await customerDoc(customer);
      expect(
        (after!.personaFilterKeys as string[]).some((token) =>
          token.startsWith('doi_nhay_cam='),
        ),
      ).toBe(false);
      // Giá trị đã nhập vẫn nằm nguyên trong hồ sơ (chỉ token lọc bị dọn).
      expect(
        (after!.persona as any[]).find(
          (item) => item.fieldKey === 'doi_nhay_cam',
        ).valueText,
      ).toBe('Giá trị');

      // Trường dữ liệu cũ có tổ hợp không còn hợp lệ: PATCH không đụng hình dạng (tắt hoạt động) vẫn được.
      await connection
        .collection('persona_fields')
        .updateOne(
          { key: 'doi_nhay_cam' },
          { $set: { isSensitive: true, isFilterable: true } },
        );
      const deactivated = await call(
        'PATCH',
        `/crm/persona-fields/${created.body.data.id}`,
        'admin',
        { isActive: false },
      );
      expect([deactivated.status, deactivated.body.data?.isActive]).toEqual([
        200,
        false,
      ]);
    });

    it('seed thêm trường mới: chỉ lần chèn thật tăng phiên bản cấu hình và kích job tính lại cho khách cũ', async () => {
      const state = () =>
        connection
          .collection('persona_config_state')
          .findOne({ _id: 'PERSONA_CONFIG' as never });
      const before = (await state())!.version;
      await connection
        .collection('persona_fields')
        .deleteOne({ key: 'specific_location' });

      const seeded = await app.get(PersonaSeedService).seedAll();
      expect(seeded).toEqual({ personaGroups: 0, personaFields: 1 });
      expect((await state())!.version).toBe(before + 1);
      await recompute.run();
      expect((await customerDoc(cX))!.personaConfigVersion).toBe(before + 1);
    });

    it('job lỗi giữa chừng: thử lại có lùi dần rồi thành công; lỗi kéo dài thì dừng sau 3 lần, không lặp vô hạn', async () => {
      const customerModel = app.get<Model<any>>(getModelToken('Customer'));
      const makeStale = () =>
        connection
          .collection('customers')
          .updateOne(
            { _id: new Types.ObjectId(cY) },
            { $set: { personaCompleteness: 99, personaConfigVersion: -1 } },
          );
      recompute.retryBaseDelayMs = 1;
      try {
        await makeStale();
        const original = customerModel.bulkWrite.bind(customerModel);
        let calls = 0;
        const flaky = jest
          .spyOn(customerModel, 'bulkWrite')
          .mockImplementation(((...args: unknown[]) => {
            calls += 1;
            if (calls === 1) return Promise.reject(new Error('db down'));
            return (original as (...a: unknown[]) => Promise<unknown>)(...args);
          }) as never);
        expect(await recompute.run()).toBeGreaterThanOrEqual(1);
        expect(calls).toBe(2);
        expect((await customerDoc(cY))!.personaCompleteness).not.toBe(99);
        flaky.mockRestore();

        await makeStale();
        const always = jest
          .spyOn(customerModel, 'bulkWrite')
          .mockRejectedValue(new Error('db down'));
        expect(await recompute.run()).toBe(0);
        expect(always).toHaveBeenCalledTimes(3);
        expect((await customerDoc(cY))!.personaConfigVersion).toBe(-1);
        always.mockRestore();

        // Việc dở vẫn nằm trong dữ liệu: lần chạy sau (khi DB khỏe) xử lý nốt.
        expect(await recompute.run()).toBeGreaterThanOrEqual(1);
        expect((await customerDoc(cY))!.personaConfigVersion).not.toBe(-1);
      } finally {
        recompute.retryBaseDelayMs = 2000;
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Thẻ: tạo, gợi ý, gắn cho khách, sửa, gộp, xóa', () => {
    const tag: Record<string, string> = {};

    it('tạo thẻ: trùng tên đã chuẩn hóa trong cùng nhóm trả thẻ có sẵn (200); khác nhóm là thẻ khác; kiểm DTO', async () => {
      const created = await call('POST', '/crm/tags', 'staffA', {
        name: 'Kế toán',
        category: 'OCCUPATION',
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        label: 'Kế toán',
        category: 'OCCUPATION',
        usageCount: 0,
      });
      tag.accountant = created.body.data.id;

      for (const name of ['ke toan', '  KẾ   TOÁN ', 'kế toán']) {
        const again = await call('POST', '/crm/tags', 'staffB', {
          name,
          category: 'OCCUPATION',
        });
        expect([name, again.status, again.body.data.id]).toEqual([
          name,
          200,
          tag.accountant,
        ]);
      }
      const other = await call('POST', '/crm/tags', 'staffA', {
        name: 'Kế toán',
        category: 'INTEREST',
      });
      expect(other.status).toBe(201);
      expect(other.body.data.id).not.toBe(tag.accountant);
      tag.accountantInterest = other.body.data.id;

      for (const body of [
        { name: '', category: 'OTHER' },
        { name: 'x'.repeat(51), category: 'OTHER' },
        { name: 'Hợp lệ', category: 'SAI' },
        { name: 'Hợp lệ' },
        { category: 'OTHER' },
        { name: 'Hợp lệ', category: 'OTHER', usageCount: 100 },
      ]) {
        expect((await call('POST', '/crm/tags', 'staffA', body)).status).toBe(
          400,
        );
      }
      expect(
        await connection
          .collection('tags')
          .countDocuments({ nameNormalized: 'ke toan', deletedAt: null }),
      ).toBe(2);
    });

    it('nhiều người tạo CÙNG tên đồng thời: đúng một thẻ được tạo, mọi người nhận cùng id', async () => {
      const results = await Promise.all(
        ['staffA', 'staffB', 'staffC', 'manager1', 'manager2', 'admin'].map(
          (as) =>
            call('POST', '/crm/tags', as, {
              name: 'Đua tạo thẻ',
              category: 'OTHER',
            }),
        ),
      );
      expect(results.every((res) => [200, 201].includes(res.status))).toBe(
        true,
      );
      expect(results.filter((res) => res.status === 201)).toHaveLength(1);
      expect(new Set(results.map((res) => res.body.data.id)).size).toBe(1);
      expect(
        await connection
          .collection('tags')
          .countDocuments({ nameNormalized: 'dua tao the' }),
      ).toBe(1);
    });

    it('giới hạn tạo thẻ 30 lần/phút/người => 429 RATE_LIMITED', async () => {
      let last: Res | undefined;
      for (let index = 0; index < 31; index += 1) {
        last = await call('POST', '/crm/tags', 'staffD', {
          name: `Thẻ spam ${index % 3}`,
          category: 'OTHER',
        });
      }
      expect([last!.status, last!.body.errorCode]).toEqual([
        429,
        'RATE_LIMITED',
      ]);
    });

    it('gợi ý khi gõ (không dấu, chứa từ khóa), lọc nhóm, sắp xếp usageCount, phân trang { data, meta }', async () => {
      const suggest = await call('GET', '/crm/tags?q=KE%20toan', 'staffA');
      expect(suggest.status).toBe(200);
      expect(suggest.body.data.map((item: any) => item.id).sort()).toEqual(
        [tag.accountant, tag.accountantInterest].sort(),
      );
      const filtered = await call(
        'GET',
        '/crm/tags?q=toan&category=OCCUPATION',
        'staffA',
      );
      expect(filtered.body.data.map((item: any) => item.id)).toEqual([
        tag.accountant,
      ]);
      expect(filtered.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
      const paged = await call('GET', '/crm/tags?limit=1&page=2', 'staffA');
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.meta.limit).toBe(1);
      expect(paged.body.meta.totalPages).toBe(paged.body.meta.total);
      expect(
        (await call('GET', '/crm/tags?sort=-usageCount', 'staffA')).status,
      ).toBe(200);
      const badSort = await call('GET', '/crm/tags?sort=createdBy', 'staffA');
      expect([badSort.status, badSort.body.errorCode]).toEqual([
        400,
        'INVALID_SORT_FIELD',
      ]);
      expect(
        (await call('GET', '/crm/tags?category=SAI', 'staffA')).status,
      ).toBe(400);
    });

    it('gắn thẻ khi tạo khách và khi sửa (thay thế toàn bộ); usageCount luôn khớp; list/detail trả tags', async () => {
      const golf = (
        await call('POST', '/crm/tags', 'staffA', {
          name: 'Golf',
          category: 'INTEREST',
        })
      ).body.data.id;
      tag.golf = golf;
      const travel = (
        await call('POST', '/crm/tags', 'staffA', {
          name: 'Du lịch',
          category: 'INTEREST',
        })
      ).body.data.id;
      tag.travel = travel;

      const cT = await createCustomer('staffA', {
        tagIds: [tag.accountant, golf, golf],
      });
      ids.cT = cT;
      const detail = await call('GET', `/crm/customers/${cT}`, 'staffA');
      expect(detail.body.data.tags.map((t: any) => t.label).sort()).toEqual([
        'Golf',
        'Kế toán',
      ]);
      await expectUsageMatches(tag.accountant);
      await expectUsageMatches(golf);
      expect((await tagDoc(golf))!.usageCount).toBe(1);

      const patched = await call('PATCH', `/crm/customers/${cT}`, 'staffA', {
        version: 0,
        tagIds: [golf, travel],
      });
      expect(patched.status).toBe(200);
      expect(patched.body.data.tags.map((t: any) => t.label).sort()).toEqual([
        'Du lịch',
        'Golf',
      ]);
      expect((await tagDoc(tag.accountant))!.usageCount).toBe(0);
      expect((await tagDoc(golf))!.usageCount).toBe(1);
      expect((await tagDoc(travel))!.usageCount).toBe(1);

      const list = await call('GET', '/crm/customers?limit=100', 'staffA');
      expect(
        list.body.data
          .find((item: any) => item.id === cT)
          .tags.map((t: any) => t.label)
          .sort(),
      ).toEqual(['Du lịch', 'Golf']);

      // PATCH không gửi tagIds giữ nguyên thẻ; gửi [] gỡ hết.
      const keep = await call('PATCH', `/crm/customers/${cT}`, 'staffA', {
        version: 1,
        fullName: 'Khách có thẻ',
      });
      expect(keep.body.data.tags).toHaveLength(2);
      const clear = await call('PATCH', `/crm/customers/${cT}`, 'staffA', {
        version: 2,
        tagIds: [],
      });
      expect(clear.body.data.tags).toEqual([]);
      await expectUsageMatches(golf);
      expect((await tagDoc(golf))!.usageCount).toBe(0);
      // khôi phục thẻ cho các test sau
      await call('PATCH', `/crm/customers/${cT}`, 'staffA', {
        version: 3,
        tagIds: [golf, tag.accountant],
      });
    });

    it('từ chối thẻ không tồn tại / đã xóa / quá 30 thẻ / id sai, không ghi gì và không lệch usageCount', async () => {
      const cT = ids.cT;
      const before = await customerDoc(cT);
      const ghost = String(new Types.ObjectId());
      for (const tagIds of [
        [ghost],
        ['abc'],
        Array.from({ length: 31 }, () => ghost),
      ]) {
        const res = await call('PATCH', `/crm/customers/${cT}`, 'staffA', {
          version: before!.__v,
          tagIds,
        });
        expect([JSON.stringify(tagIds).slice(0, 40), res.status]).toEqual([
          JSON.stringify(tagIds).slice(0, 40),
          400,
        ]);
      }
      const removedTag = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Sẽ xóa',
          category: 'OTHER',
        })
      ).body.data.id;
      await call('DELETE', `/crm/tags/${removedTag}`, 'admin');
      const res = await call('PATCH', `/crm/customers/${cT}`, 'staffA', {
        version: before!.__v,
        tagIds: [removedTag],
      });
      expect(res.status).toBe(400);
      expect((await customerDoc(cT))!.tagIds).toEqual(before!.tagIds);
      expect((await customerDoc(cT))!.__v).toBe(before!.__v);
      // tạo khách với thẻ xóa cũng 400 và không tạo khách
      const phone = nextPhone();
      const create = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'Không được tạo',
        phone,
        tagIds: [removedTag],
      });
      expect(create.status).toBe(400);
      expect(
        await connection
          .collection('customers')
          .countDocuments({ fullName: 'Không được tạo' }),
      ).toBe(0);
    });

    it('lọc danh sách theo thẻ (bất kỳ thẻ), chân dung (nghề nghiệp tiền tố, personaFilters HOẶC/VÀ) và theo phạm vi', async () => {
      const cF = await createCustomer('staffA', { tagIds: [tag.travel] });
      await patchPersona(cF, 'staffA', [
        text('occupation', 'Kế toán viên'),
        {
          fieldKey: 'property_type',
          value: { valueOptions: ['APARTMENT'] },
          source: 'CUSTOMER_SHARED',
        },
        {
          fieldKey: 'purchase_purposes',
          value: { valueOptions: ['INVEST_RENT'] },
          source: 'CUSTOMER_SHARED',
        },
      ]);
      const cG = await createCustomer('staffC', { tagIds: [tag.travel] });
      await patchPersona(cG, 'staffC', [text('occupation', 'Kế toán')]);

      const idsOf = async (query: string, as: string) => {
        const res = await call('GET', `/crm/customers?limit=100&${query}`, as);
        expect([query, res.status]).toEqual([query, 200]);
        return res.body.data.map((item: any) => item.id) as string[];
      };

      expect((await idsOf(`tagIds=${tag.travel}`, 'admin')).sort()).toEqual(
        [cF, cG].sort(),
      );
      // staffA chỉ thấy khách của mình; staffC chỉ thấy khách của mình.
      expect(await idsOf(`tagIds=${tag.travel}`, 'staffA')).toEqual([cF]);
      expect(await idsOf(`tagIds=${tag.travel}`, 'staffC')).toEqual([cG]);
      expect(await idsOf(`tagIds=${tag.travel}`, 'manager1')).toEqual([cF]);
      // tagIds nhiều giá trị là HOẶC
      expect(
        (await idsOf(`tagIds=${tag.travel},${tag.golf}`, 'admin')).sort(),
      ).toEqual([cF, cG, ids.cT].sort());

      // Nghề nghiệp: khớp tiền tố không dấu (cA cũng là "Kế toán trưởng"); thêm tagIds để tách riêng cF, cG.
      expect(
        (
          await idsOf(`occupation=ke%20toan&tagIds=${tag.travel}`, 'admin')
        ).sort(),
      ).toEqual([cF, cG].sort());
      expect((await idsOf('occupation=ke%20toan', 'admin')).sort()).toEqual(
        [ids.cA, cF, cG].sort(),
      );
      expect(await idsOf('occupation=KẾ%20TOÁN%20VIÊN', 'admin')).toEqual([cF]);
      expect(await idsOf('occupation=%2E%2A', 'admin')).toEqual([]);

      const only = `&tagIds=${tag.travel}`;
      expect(
        await idsOf(`personaFilters=property_type:APARTMENT${only}`, 'admin'),
      ).toEqual([cF]);
      // cùng fieldKey là HOẶC
      expect(
        await idsOf(
          `personaFilters=property_type:APARTMENT,property_type:TOWNHOUSE${only}`,
          'admin',
        ),
      ).toEqual([cF]);
      // khác fieldKey là VÀ
      expect(
        await idsOf(
          `personaFilters=property_type:APARTMENT,purchase_purposes:INVEST_RENT${only}`,
          'admin',
        ),
      ).toEqual([cF]);
      expect(
        await idsOf(
          `personaFilters=property_type:APARTMENT,purchase_purposes:LIVING${only}`,
          'admin',
        ),
      ).toEqual([]);
      // Không giới hạn thẻ: chỉ cA vừa là căn hộ vừa có mục đích ở thực.
      expect(
        await idsOf(
          'personaFilters=property_type:APARTMENT,purchase_purposes:LIVING',
          'admin',
        ),
      ).toEqual([ids.cA]);
      // Phạm vi: nhân viên khác không thấy khách của người khác dù khớp bộ lọc.
      expect(
        await idsOf('personaFilters=property_type:APARTMENT', 'staffB'),
      ).toEqual([]);
      // Trường không lọc được (hometown) và định dạng sai.
      expect(
        await idsOf('personaFilters=hometown:Quang%20Binh', 'admin'),
      ).toEqual([]);
      expect(
        (
          await call(
            'GET',
            '/crm/customers?personaFilters=khongcohaicham',
            'admin',
          )
        ).status,
      ).toBe(400);
      // list-counts nhận cùng bộ lọc
      const counts = await call(
        'GET',
        `/crm/customers/list-counts?tagIds=${tag.travel}`,
        'admin',
      );
      expect(counts.body.data.ALL).toBe(2);
      // sắp xếp theo độ đầy đủ chân dung
      const sorted = await call(
        'GET',
        '/crm/customers?sort=-personaCompleteness&limit=100',
        'admin',
      );
      const completeness = sorted.body.data.map(
        (item: any) => item.personaCompleteness,
      );
      expect([...completeness].sort((a: number, b: number) => b - a)).toEqual(
        completeness,
      );
      ids.cF = cF;
      ids.cG = cG;
    });

    it('sửa thẻ: đổi tên/nhóm/màu; trùng tên trong nhóm 409; không đổi gì thì no-op', async () => {
      const renamed = await call('PATCH', `/crm/tags/${tag.travel}`, 'admin', {
        name: 'Du lịch nghỉ dưỡng',
        color: '#3b82f6',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data).toMatchObject({
        label: 'Du lịch nghỉ dưỡng',
        color: '#3b82f6',
      });
      const detail = await call('GET', `/crm/customers/${ids.cF}`, 'staffA');
      expect(detail.body.data.tags[0].label).toBe('Du lịch nghỉ dưỡng');

      const clash = await call('PATCH', `/crm/tags/${tag.travel}`, 'admin', {
        name: 'golf',
      });
      expect([clash.status, clash.body.errorCode]).toEqual([
        409,
        'CATALOG_DUPLICATED',
      ]);
      expect(
        (
          await call('PATCH', `/crm/tags/${tag.travel}`, 'admin', {
            name: 'Du lịch nghỉ dưỡng',
          })
        ).status,
      ).toBe(200);
      for (const body of [
        { color: 'xanh lè lè lè lè lè lè' },
        { category: 'SAI' },
        { name: '' },
        { id: 'x' },
      ]) {
        expect(
          (await call('PATCH', `/crm/tags/${tag.travel}`, 'admin', body))
            .status,
        ).toBe(400);
      }
      expect(
        (
          await call(
            'PATCH',
            `/crm/tags/${String(new Types.ObjectId())}`,
            'admin',
            {
              name: 'Gì đó',
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (await call('PATCH', '/crm/tags/khong-phai-id', 'admin', { name: 'x' }))
          .status,
      ).toBe(400);
    });

    it('gộp thẻ: khách chuyển sang thẻ đích (gắn cả hai chỉ còn một), thẻ nguồn xóa mềm, usageCount đích đếm lại; kiểm lỗi', async () => {
      const src = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Gộp nguồn',
          category: 'OTHER',
        })
      ).body.data.id;
      const dst = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Gộp đích',
          category: 'OTHER',
        })
      ).body.data.id;
      const onlySrc = await createCustomer('staffA', { tagIds: [src] });
      const both = await createCustomer('staffA', { tagIds: [src, dst] });
      const onlyDst = await createCustomer('staffA', { tagIds: [dst] });
      await expectUsageMatches(src);

      const mixed = await call('PATCH', `/crm/tags/${src}`, 'admin', {
        mergeIntoId: dst,
        name: 'Khác',
      });
      expect(mixed.status).toBe(400);
      const self = await call('PATCH', `/crm/tags/${src}`, 'admin', {
        mergeIntoId: src,
      });
      expect(self.status).toBe(400);
      const missing = await call('PATCH', `/crm/tags/${src}`, 'admin', {
        mergeIntoId: String(new Types.ObjectId()),
      });
      expect(missing.status).toBe(404);

      const merged = await call('PATCH', `/crm/tags/${src}`, 'admin', {
        mergeIntoId: dst,
      });
      expect(merged.status).toBe(200);
      expect(merged.body.data).toMatchObject({ id: dst, usageCount: 3 });
      expect(
        ((await customerDoc(onlySrc))!.tagIds as Types.ObjectId[]).map(String),
      ).toEqual([dst]);
      expect(
        ((await customerDoc(both))!.tagIds as Types.ObjectId[]).map(String),
      ).toEqual([dst]);
      expect(
        ((await customerDoc(onlyDst))!.tagIds as Types.ObjectId[]).map(String),
      ).toEqual([dst]);
      await expectUsageMatches(dst);
      const srcDoc = await tagDoc(src);
      expect(srcDoc!.deletedAt).not.toBeNull();
      expect(String(srcDoc!.mergedIntoId)).toBe(dst);
      expect(
        (await call('GET', '/crm/tags?q=gop%20nguon', 'admin')).body.data,
      ).toEqual([]);
      // thẻ nguồn không còn gắn được và không gộp lại lần hai
      expect(
        (await call('PATCH', `/crm/tags/${src}`, 'admin', { mergeIntoId: dst }))
          .status,
      ).toBe(404);
      const assign = await call(
        'PATCH',
        `/crm/customers/${onlyDst}`,
        'staffA',
        { version: 0, tagIds: [src] },
      );
      expect(assign.status).toBe(400);
      expect(
        await connection.collection('crm_audit_logs').countDocuments({
          action: 'TAG_MERGED',
          entityId: new Types.ObjectId(src),
        }),
      ).toBe(1);
    });

    it('xóa thẻ: gỡ khỏi mọi khách (kể cả khách xóa mềm), thẻ ẩn khỏi danh sách, ghi audit; xóa lại 404', async () => {
      const victim = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Thẻ bị xóa',
          category: 'OTHER',
        })
      ).body.data.id;
      const c1 = await createCustomer('staffA', { tagIds: [victim, tag.golf] });
      const c2 = await createCustomer('staffA', { tagIds: [victim] });
      await call('DELETE', `/crm/customers/${c2}?reason=thu%20nghiem`, 'admin');
      await expectUsageMatches(victim);

      const del = await call('DELETE', `/crm/tags/${victim}`, 'admin');
      expect(del.status).toBe(204);
      expect(
        await connection
          .collection('customers')
          .countDocuments({ tagIds: new Types.ObjectId(victim) }),
      ).toBe(0);
      expect(
        ((await customerDoc(c1))!.tagIds as Types.ObjectId[]).map(String),
      ).toEqual([tag.golf]);
      expect(
        (
          await call('GET', `/crm/customers/${c1}`, 'staffA')
        ).body.data.tags.map((t: any) => t.label),
      ).toEqual(['Golf']);
      expect(
        (await call('GET', '/crm/tags?q=bi%20xoa', 'admin')).body.data,
      ).toEqual([]);
      expect(
        (await call('DELETE', `/crm/tags/${victim}`, 'admin')).status,
      ).toBe(404);
      expect(
        await connection.collection('crm_audit_logs').countDocuments({
          action: 'TAG_DELETED',
          entityId: new Types.ObjectId(victim),
        }),
      ).toBe(1);
      await expectUsageMatches(tag.golf);
    });

    it('gắn thẻ đồng thời với xóa thẻ: không bao giờ còn khách trỏ vào thẻ đã xóa', async () => {
      for (let round = 0; round < 4; round += 1) {
        const doomed = (
          await call('POST', '/crm/tags', 'admin', {
            name: `Thẻ đua ${round}`,
            category: 'OTHER',
          })
        ).body.data.id;
        const customer = await createCustomer('staffA');
        const [assign, remove] = await Promise.all([
          call('PATCH', `/crm/customers/${customer}`, 'staffA', {
            version: 0,
            tagIds: [doomed],
          }),
          call('DELETE', `/crm/tags/${doomed}`, 'admin'),
        ]);
        expect(remove.status).toBe(204);
        expect([200, 400]).toContain(assign.status);
        expect(
          await connection
            .collection('customers')
            .countDocuments({ tagIds: new Types.ObjectId(doomed) }),
        ).toBe(0);
      }
    });

    it('tên thẻ: chữ rộng/ký tự vô hình trùng thẻ có sẵn; tên chỉ gồm ký tự vô hình bị từ chối (400)', async () => {
      for (const name of ['Ｇｏｌｆ', 'Go\u200Blf']) {
        const res = await call('POST', '/crm/tags', 'staffA', {
          name,
          category: 'INTEREST',
        });
        expect([JSON.stringify(name), res.status, res.body.data.id]).toEqual([
          JSON.stringify(name),
          200,
          tag.golf,
        ]);
      }
      for (const name of ['\u200B\u200D', '\u2060']) {
        const res = await call('POST', '/crm/tags', 'staffA', {
          name,
          category: 'OTHER',
        });
        expect([JSON.stringify(name), res.status]).toEqual([
          JSON.stringify(name),
          400,
        ]);
      }
      const rename = await call('PATCH', `/crm/tags/${tag.golf}`, 'admin', {
        name: '\u200B',
      });
      expect(rename.status).toBe(400);
      expect((await tagDoc(tag.golf))!.name).toBe('Golf');
    });

    it('gộp thẻ khác nhóm bị từ chối (400); đổi riêng nhóm gây trùng báo đúng tên thẻ', async () => {
      const cross = await call(
        'PATCH',
        `/crm/tags/${tag.accountant}`,
        'admin',
        {
          mergeIntoId: tag.golf,
        },
      );
      expect([cross.status, cross.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect((await tagDoc(tag.accountant))!.deletedAt).toBeNull();

      const clash = await call(
        'PATCH',
        `/crm/tags/${tag.accountantInterest}`,
        'admin',
        { category: 'OCCUPATION' },
      );
      expect([clash.status, clash.body.errorCode, clash.body.details]).toEqual([
        409,
        'CATALOG_DUPLICATED',
        { field: 'name', value: 'Kế toán' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Thao tác hàng loạt ADD_TAGS / REMOVE_TAGS (bật thật sự, theo phạm vi)', () => {
    let bulkTag: string;
    let bulkTag2: string;
    let mineA1: string;
    let mineA2: string;
    let mineC: string;
    /** Id thẻ chưa từng gắn cho khách: gỡ thẻ không có trên khách phải thành công, không lỗi. */
    const tag0 = () => String(new Types.ObjectId());
    const bulk = (
      as: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) => call('POST', '/crm/customer-bulk-operations', as, body, headers);

    beforeAll(async () => {
      bulkTag = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Bulk một',
          category: 'OTHER',
        })
      ).body.data.id;
      bulkTag2 = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Bulk hai',
          category: 'OTHER',
        })
      ).body.data.id;
      mineA1 = await createCustomer('staffA');
      mineA2 = await createCustomer('staffA');
      mineC = await createCustomer('staffC');
    });

    it('Nhân viên chỉ gắn được cho khách trong phạm vi; khách ngoài phạm vi báo CUSTOMER_NOT_FOUND và không bị đụng', async () => {
      const res = await bulk('staffA', {
        type: 'ADD_TAGS',
        customerIds: [mineA1, mineA2, mineC, String(new Types.ObjectId())],
        payload: { tagIds: [bulkTag] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded.sort()).toEqual([mineA1, mineA2].sort());
      expect(res.body.data.failed).toEqual(
        expect.arrayContaining([
          { customerId: mineC, errorCode: 'CUSTOMER_NOT_FOUND' },
        ]),
      );
      expect(res.body.data.failed).toHaveLength(2);
      expect(((await customerDoc(mineC))!.tagIds as unknown[]).length).toBe(0);
      expect((await tagDoc(bulkTag))!.usageCount).toBe(2);
      await expectUsageMatches(bulkTag);
      expect((await auditOf(mineA1, 'TAGS_UPDATED')).length).toBe(1);
    });

    it('Quản lý chỉ trong nhóm mình; Quản trị tất cả; gắn lại là thành công nhưng không ghi gì (usageCount không đếm đôi)', async () => {
      const manager = await bulk('manager2', {
        type: 'ADD_TAGS',
        customerIds: [mineA1, mineC],
        payload: { tagIds: [bulkTag, bulkTag2] },
      });
      expect(manager.body.data.succeeded).toEqual([mineC]);
      expect(manager.body.data.failed).toEqual([
        { customerId: mineA1, errorCode: 'CUSTOMER_NOT_FOUND' },
      ]);

      const admin = await bulk('admin', {
        type: 'ADD_TAGS',
        customerIds: [mineA1, mineA2, mineC],
        payload: { tagIds: [bulkTag, bulkTag2] },
      });
      expect(admin.body.data.succeeded.sort()).toEqual(
        [mineA1, mineA2, mineC].sort(),
      );
      expect(admin.body.data.failed).toEqual([]);
      await expectUsageMatches(bulkTag);
      await expectUsageMatches(bulkTag2);
      expect((await tagDoc(bulkTag))!.usageCount).toBe(3);
      // khách đã có đủ thẻ: không thêm audit
      expect((await auditOf(mineA1, 'TAGS_UPDATED')).length).toBe(2);
      const again = await bulk('admin', {
        type: 'ADD_TAGS',
        customerIds: [mineA1],
        payload: { tagIds: [bulkTag] },
      });
      expect(again.body.data.succeeded).toEqual([mineA1]);
      expect((await auditOf(mineA1, 'TAGS_UPDATED')).length).toBe(2);
      expect(((await customerDoc(mineA1))!.tagIds as unknown[]).length).toBe(2);
    });

    it('REMOVE_TAGS gỡ đúng thẻ chỉ định; gỡ thẻ khách chưa có là thành công; thẻ đã xóa vẫn gỡ được; khách ngoài phạm vi không bị đụng', async () => {
      const res = await bulk('staffA', {
        type: 'REMOVE_TAGS',
        customerIds: [mineA1, mineA2],
        payload: { tagIds: [bulkTag, tag0()] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded.sort()).toEqual([mineA1, mineA2].sort());
      expect(
        ((await customerDoc(mineA1))!.tagIds as Types.ObjectId[]).map(String),
      ).toEqual([bulkTag2]);
      await expectUsageMatches(bulkTag);
      await expectUsageMatches(bulkTag2);

      const doomed = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Bulk bị xóa',
          category: 'OTHER',
        })
      ).body.data.id;
      await bulk('admin', {
        type: 'ADD_TAGS',
        customerIds: [mineA2],
        payload: { tagIds: [doomed] },
      });
      // Xóa thẻ đã tự gỡ khỏi khách; REMOVE với thẻ đã xóa vẫn thành công (không còn gì để gỡ).
      await call('DELETE', `/crm/tags/${doomed}`, 'admin');
      const remove = await bulk('admin', {
        type: 'REMOVE_TAGS',
        customerIds: [mineA2],
        payload: { tagIds: [doomed] },
      });
      expect(remove.body.data.succeeded).toEqual([mineA2]);

      // Khách ngoài phạm vi: báo CUSTOMER_NOT_FOUND và không bị gỡ thẻ.
      const outside = await customerDoc(mineC);
      const usage = (await tagDoc(bulkTag))!.usageCount;
      const denied = await bulk('staffA', {
        type: 'REMOVE_TAGS',
        customerIds: [mineC],
        payload: { tagIds: [bulkTag] },
      });
      expect(denied.body.data).toEqual({
        succeeded: [],
        failed: [{ customerId: mineC, errorCode: 'CUSTOMER_NOT_FOUND' }],
      });
      expect((await customerDoc(mineC))!.tagIds).toEqual(outside!.tagIds);
      expect((await tagDoc(bulkTag))!.usageCount).toBe(usage);
    });

    it('payload sai: thiếu/rỗng tagIds, thẻ không tồn tại/đã xóa (ADD) => 400 cho cả lô và không ghi gì', async () => {
      const gone = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Bulk mất',
          category: 'OTHER',
        })
      ).body.data.id;
      await call('DELETE', `/crm/tags/${gone}`, 'admin');
      const before = await customerDoc(mineA1);
      for (const payload of [
        {},
        { tagIds: [] },
        { tagIds: [gone] },
        { tagIds: [String(new Types.ObjectId())] },
        { tagIds: ['abc'] },
      ]) {
        const res = await bulk('admin', {
          type: 'ADD_TAGS',
          customerIds: [mineA1],
          payload,
        });
        expect([JSON.stringify(payload), res.status]).toEqual([
          JSON.stringify(payload),
          400,
        ]);
      }
      expect(
        (
          await bulk('admin', {
            type: 'REMOVE_TAGS',
            customerIds: [mineA1],
            payload: {},
          })
        ).status,
      ).toBe(400);
      expect((await customerDoc(mineA1))!.tagIds).toEqual(before!.tagIds);
      expect(
        (
          await bulk('editor', {
            type: 'ADD_TAGS',
            customerIds: [mineA1],
            payload: { tagIds: [bulkTag] },
          })
        ).status,
      ).toBe(403);
    });

    it('vượt 30 thẻ/khách: khách đó thất bại VALIDATION_FAILED, khách khác vẫn thành công', async () => {
      // Dựng thẻ thẳng vào DB (tạo qua API sẽ chạm giới hạn 30 lần/phút của Quản trị).
      const inserted = await connection.collection('tags').insertMany(
        Array.from({ length: 30 }, (_, index) => ({
          name: `Đầy ${index}`,
          nameNormalized: `day ${index}`,
          category: 'OTHER',
          usageCount: 0,
          color: null,
          deletedAt: null,
        })),
      );
      const many = Object.values(inserted.insertedIds).map(String);
      const full = await createCustomer('staffA', { tagIds: many });
      const free = await createCustomer('staffA');
      const res = await bulk('admin', {
        type: 'ADD_TAGS',
        customerIds: [full, free],
        payload: { tagIds: [bulkTag] },
      });
      expect(res.body.data.succeeded).toEqual([free]);
      expect(res.body.data.failed).toEqual([
        { customerId: full, errorCode: 'VALIDATION_FAILED' },
      ]);
      await expectUsageMatches(bulkTag);
    });

    it('X-Idempotency-Key: gửi lại cùng khóa trả lại đúng phản hồi cũ và KHÔNG chạy lại', async () => {
      const key = `bulk-tags-${randomUUID()}`;
      const body = {
        type: 'ADD_TAGS',
        customerIds: [mineA2],
        payload: { tagIds: [bulkTag] },
      };
      const first = await bulk('staffA', body, { 'x-idempotency-key': key });
      expect(first.body.data.succeeded).toEqual([mineA2]);
      // Gỡ thẻ bằng đường khác; nếu replay chạy lại thì thẻ sẽ quay lại.
      await bulk('staffA', {
        type: 'REMOVE_TAGS',
        customerIds: [mineA2],
        payload: { tagIds: [bulkTag] },
      });
      const replay = await bulk('staffA', body, { 'x-idempotency-key': key });
      expect(replay.status).toBe(first.status);
      expect(replay.body).toEqual(first.body);
      expect(
        ((await customerDoc(mineA2))!.tagIds as Types.ObjectId[]).map(String),
      ).not.toContain(bulkTag);
      await expectUsageMatches(bulkTag);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Ẩn danh hóa dọn chân dung và thẻ', () => {
    it('xóa sạch chân dung, token lọc, dịp đặc biệt, thẻ (usageCount giảm) và ghi đè giá trị trong audit; hồ sơ không xem được nữa', async () => {
      const tagA = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Ẩn danh A',
          category: 'OCCUPATION',
        })
      ).body.data.id;
      const tagB = (
        await call('POST', '/crm/tags', 'admin', {
          name: 'Ẩn danh B',
          category: 'OTHER',
        })
      ).body.data.id;
      const customer = await createCustomer('staffA', { tagIds: [tagA, tagB] });
      const other = await createCustomer('staffA', { tagIds: [tagA] });
      const set = await patchPersona(customer, 'staffA', [
        text('occupation', 'Giám đốc ngân hàng ABC'),
        text('children', 'Hai con, học trường X'),
        {
          fieldKey: 'birthday',
          value: { valueDate: '1985-12-01' },
          source: 'CUSTOMER_SHARED',
        },
      ]);
      expect(set.status).toBe(200);
      await call('PATCH', `/crm/customers/${customer}`, 'staffA', {
        version: 1,
        tagIds: [tagA],
      });
      expect((await tagDoc(tagA))!.usageCount).toBe(2);
      expect((await tagDoc(tagB))!.usageCount).toBe(0);
      await call('PATCH', `/crm/customers/${customer}`, 'staffA', {
        version: 2,
        tagIds: [tagA, tagB],
      });

      const res = await call('POST', '/crm/customer-anonymizations', 'admin', {
        customerId: customer,
        reason: 'Khách Nguyễn Văn A yêu cầu xóa dữ liệu',
        confirm: true,
      });
      expect(res.status).toBe(201);

      const doc = await customerDoc(customer);
      expect(doc).toMatchObject({
        persona: [],
        personaFilterKeys: [],
        occasions: [],
        personaCompleteness: 0,
        tagIds: [],
      });
      expect((await tagDoc(tagA))!.usageCount).toBe(1);
      expect((await tagDoc(tagB))!.usageCount).toBe(0);
      await expectUsageMatches(tagA);
      await expectUsageMatches(tagB);
      expect(
        ((await customerDoc(other))!.tagIds as Types.ObjectId[]).map(String),
      ).toEqual([tagA]);

      const personaAudit = JSON.stringify(
        await auditOf(customer, 'PERSONA_UPDATED'),
      );
      expect(personaAudit).not.toContain('Giám đốc ngân hàng ABC');
      expect(personaAudit).not.toContain('học trường X');
      expect(personaAudit).not.toContain('1985-12-01');
      expect(personaAudit).toContain('[đã ẩn danh]');
      const tagsAudit = JSON.stringify(
        await connection
          .collection('crm_audit_logs')
          .find({
            customerId: new Types.ObjectId(customer),
            'changes.field': 'tags',
          })
          .toArray(),
      );
      expect(tagsAudit).not.toContain('Ẩn danh A');
      expect((await getPersona(customer, 'admin')).status).toBe(404);
      // Danh mục mẫu của regex ẩn danh có cả persona.* và tags.
      expect(PII_AUDIT_FIELD_PATTERNS).toEqual(
        expect.arrayContaining(['^persona\\..+$', '^tags$']),
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Tắt ứng dụng', () => {
    it('job nền ngừng nhận việc khi đang tắt; việc dở nằm nguyên trong dữ liệu cho lần khởi động sau', async () => {
      const customer = await createCustomer('staffA');
      await patchPersona(customer, 'staffA', [text('hometown', 'Huế')]);
      await connection
        .collection('customers')
        .updateOne(
          { _id: new Types.ObjectId(customer) },
          { $set: { personaConfigVersion: -1, personaCompleteness: 99 } },
        );
      await recompute.onApplicationShutdown();
      expect(await recompute.run()).toBe(0);
      expect((await customerDoc(customer))!.personaConfigVersion).toBe(-1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Swagger', () => {
    it('có đủ 11 route M4 (persona-fields 5, tags 4, persona của khách 2)', () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('qa').addBearerAuth().build(),
      );
      const ops = Object.entries(doc.paths).flatMap(([route, item]) =>
        Object.keys(item as object)
          .filter((verb) =>
            ['get', 'post', 'patch', 'put', 'delete'].includes(verb),
          )
          .map((verb) => `${verb.toUpperCase()} ${route}`),
      );
      const m4 = ops.filter((op) =>
        /\/crm\/(persona-fields|tags)|\/persona$/.test(op),
      );
      expect(m4.sort()).toEqual(
        [
          'GET /api/v1/crm/persona-fields',
          'POST /api/v1/crm/persona-fields',
          'PUT /api/v1/crm/persona-fields/order',
          'PATCH /api/v1/crm/persona-fields/{id}',
          'DELETE /api/v1/crm/persona-fields/{id}',
          'GET /api/v1/crm/tags',
          'POST /api/v1/crm/tags',
          'PATCH /api/v1/crm/tags/{id}',
          'DELETE /api/v1/crm/tags/{id}',
          'GET /api/v1/crm/customers/{id}/persona',
          'PATCH /api/v1/crm/customers/{id}/persona',
        ].sort(),
      );
    });
  });
});
