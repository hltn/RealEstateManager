/**
 * INTEGRATION — FR-40 (T-09, T-10): khách ghi kép id + `code`, API nhận cả hai, lọc/đếm theo `code`, audit
 * `fromCode/toCode`, hợp đồng Architecture 4.2. HTTP thật (Fastify + ValidationPipe `forbidNonWhitelisted` + filter)
 * trên MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis/MinIO (rate limit hàng loạt được stub).
 * Các `it` chạy THEO THỨ TỰ và dùng chung dữ liệu dựng ở `beforeAll`/các bước trước.
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
import { ThrottlerModule } from '@nestjs/throttler';
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
import { CatalogItemType } from './catalogs/catalog.enums';
import { CrmUsageService } from './common/crm-usage.service';
import { CrmRateLimitService } from './common/security/crm-rate-limit.service';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(300_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';

interface Res {
  status: number;
  body: any;
}

describe('FR-40: khách ghi kép id + code, lọc/đếm theo code (HTTP + Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let token: string;
  let adminId: Types.ObjectId;
  let phoneSeq = 10;

  const statusId: Record<string, string> = {};
  const sources: Array<{ id: string; code: string; label: string }> = [];
  const areas: Array<{ id: string; code: string; name: string }> = [];
  const projects: Record<string, { id: string; code: string }> = {};
  const state: Record<string, any> = {};

  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : {},
    };
  };

  const nextPhone = (): string =>
    `09123456${String(phoneSeq++).padStart(2, '0')}`;
  const rawCustomer = (id: string) =>
    connection.collection('customers').findOne({ _id: new Types.ObjectId(id) });
  const auditOf = (id: string, action: string) =>
    connection
      .collection('crm_audit_logs')
      .find({ entityId: new Types.ObjectId(id), action })
      .sort({ _id: 1 })
      .toArray();
  const createCustomer = async (extra: Record<string, unknown> = {}) => {
    const res = await call('POST', '/crm/customers', {
      fullName: 'Khách FR40',
      phone: nextPhone(),
      ...extra,
    });
    return res;
  };

  /** Khách "kiểu image v1.0.3": chỉ có id, KHÔNG có `…Code` (chèn thẳng driver). */
  const insertLegacyCustomer = async (
    overrides: Record<string, unknown> = {},
  ) => {
    const _id = new Types.ObjectId();
    await connection.collection('customers').insertOne({
      _id,
      fullName: 'Khách cũ',
      phone: `+8491234${String(5000 + phoneSeq++)}`,
      email: null,
      statusId: new Types.ObjectId(statusId.INTERESTED),
      statusChangedAt: new Date(),
      sourceId: null,
      interestedProjectIds: [],
      areaId: null,
      tagIds: [],
      criteria: {},
      progress: 0,
      careTeam: [],
      primaryAssigneeId: null,
      teamIds: [],
      persona: [],
      personaFilterKeys: [],
      occasions: [],
      personaCompleteness: 0,
      personaConfigVersion: 0,
      dataConsent: {},
      lastUpdatedAt: new Date(),
      lastUpdatedBy: adminId,
      searchText: '',
      createdVia: 'WEB',
      createdBy: adminId,
      deletedAt: null,
      __v: 0,
      ...overrides,
    });
    return String(_id);
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = 'it-fr40-' + Date.now() + ':';
    replSet = await createMemoryReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        // Như AppModule: NotificationsModule (push) dùng ThrottlerGuard nên cần ThrottlerModule toàn cục.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
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
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const admin = await userModel.create({
      email: 'admin@fr40.vn',
      password: 'hash',
      displayName: 'admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    adminId = admin._id;
    token = app.get(JwtService).sign({
      sub: String(admin._id),
      email: admin.email,
      role: UserRole.ADMIN,
    });

    for (const row of await connection
      .collection('customer_statuses')
      .find({})
      .toArray()) {
      statusId[row.code as string] = String(row._id);
    }
    for (const row of await connection
      .collection('catalog_items')
      .find({ type: CatalogItemType.LEAD_SOURCE })
      .sort({ code: 1 })
      .limit(3)
      .toArray()) {
      sources.push({
        id: String(row._id),
        code: row.code as string,
        label: row.label as string,
      });
    }
    for (const row of await connection
      .collection('areas')
      .find({ code: { $type: 'string' } })
      .sort({ code: 1 })
      .limit(3)
      .toArray()) {
      areas.push({
        id: String(row._id),
        code: row.code as string,
        name: row.name as string,
      });
    }
    for (const code of ['FR40A', 'FR40B', 'FR40C']) {
      const res = await call('POST', '/crm/projects', {
        name: `Dự án ${code}`,
        code,
      });
      expect(res.status).toBe(201);
      projects[code] = { id: res.body.data.id, code };
    }
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  describe('tạo khách', () => {
    it('FR-40: tạo bằng …Code ghi CẢ id lẫn code; response là { id, code, label }; mã dự án chữ thường được chuẩn hóa và giữ thứ tự', async () => {
      const res = await createCustomer({
        statusCode: 'INTERESTED',
        sourceCode: sources[0].code,
        areaCode: areas[0].code,
        projectCodes: ['fr40b', 'FR40A'],
      });
      expect(res.status).toBe(201);
      const data = res.body.data;
      state.byCode = data.id;
      expect(data.status).toMatchObject({ code: 'INTERESTED' });
      expect(data.source).toEqual({
        id: sources[0].id,
        code: sources[0].code,
        label: sources[0].label,
      });
      expect(data.area).toMatchObject({ id: areas[0].id, code: areas[0].code });
      expect(data.projects.map((p: any) => p.code)).toEqual(['FR40B', 'FR40A']);

      const raw = (await rawCustomer(data.id))!;
      expect(String(raw.statusId)).toBe(statusId.INTERESTED);
      expect(raw.statusCode).toBe('INTERESTED');
      expect(String(raw.sourceId)).toBe(sources[0].id);
      expect(raw.sourceCode).toBe(sources[0].code);
      expect(String(raw.areaId)).toBe(areas[0].id);
      expect(raw.areaCode).toBe(areas[0].code);
      expect(raw.interestedProjectIds.map(String)).toEqual([
        projects.FR40B.id,
        projects.FR40A.id,
      ]);
      expect(raw.interestedProjectCodes).toEqual(['FR40B', 'FR40A']);
    });

    it('FR-40: audit CUSTOMER_CREATED có fromCode/toCode cho tình trạng, nguồn, khu vực, dự án', async () => {
      const [entry] = await auditOf(state.byCode, 'CUSTOMER_CREATED');
      const change = (field: string) =>
        entry.changes.find((c: any) => c.field === field);
      expect(change('status')).toMatchObject({
        fromCode: null,
        toCode: 'INTERESTED',
      });
      expect(change('source')).toMatchObject({
        fromCode: null,
        toCode: sources[0].code,
      });
      expect(change('area')).toMatchObject({
        fromCode: null,
        toCode: areas[0].code,
      });
      expect(change('projects')).toMatchObject({
        fromCode: [],
        toCode: ['FR40B', 'FR40A'],
      });
    });

    it('FR-40: tạo bằng …Id (cũ) vẫn điền code; không chọn tình trạng thì lấy mặc định kèm code', async () => {
      const res = await createCustomer({
        sourceId: sources[1].id,
        areaId: areas[1].id,
        interestedProjectIds: [projects.FR40C.id],
      });
      expect(res.status).toBe(201);
      state.byId = res.body.data.id;
      const raw = (await rawCustomer(state.byId))!;
      expect(raw.statusCode).toBe('NOT_CONTACTED');
      expect(String(raw.statusId)).toBe(statusId.NOT_CONTACTED);
      expect(raw.sourceCode).toBe(sources[1].code);
      expect(raw.areaCode).toBe(areas[1].code);
      expect(raw.interestedProjectCodes).toEqual(['FR40C']);
    });

    it('FR-40: gửi cả id lẫn code cùng bản ghi thì chấp nhận', async () => {
      const res = await createCustomer({
        sourceId: sources[2].id,
        sourceCode: sources[2].code,
        interestedProjectIds: [projects.FR40A.id],
        projectCodes: ['FR40A'],
      });
      expect(res.status).toBe(201);
      state.both = res.body.data.id;
    });

    it.each([
      [
        'statusId lệch statusCode',
        (): Record<string, unknown> => ({
          statusId: statusId.NET,
          statusCode: 'INTERESTED',
        }),
      ],
      [
        'sourceId lệch sourceCode',
        (): Record<string, unknown> => ({
          sourceId: sources[0].id,
          sourceCode: sources[1].code,
        }),
      ],
      [
        'areaId lệch areaCode',
        (): Record<string, unknown> => ({
          areaId: areas[0].id,
          areaCode: areas[1].code,
        }),
      ],
      [
        'projectIds lệch projectCodes',
        (): Record<string, unknown> => ({
          interestedProjectIds: [projects.FR40A.id],
          projectCodes: ['FR40B'],
        }),
      ],
      [
        'sourceId null mà có sourceCode',
        (): Record<string, unknown> => ({
          sourceId: null,
          sourceCode: sources[0].code,
        }),
      ],
      [
        'code không tồn tại',
        (): Record<string, unknown> => ({ sourceCode: 'KHONG_TON_TAI' }),
      ],
      [
        'mã dự án không tồn tại',
        (): Record<string, unknown> => ({
          projectCodes: ['FR40A', 'KHONG_CO'],
        }),
      ],
    ])(
      'FR-40: %s thì 400 VALIDATION_FAILED và không tạo khách',
      async (_name, make) => {
        const before = await connection
          .collection('customers')
          .countDocuments();
        const res = await createCustomer(make());
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('VALIDATION_FAILED');
        expect(await connection.collection('customers').countDocuments()).toBe(
          before,
        );
      },
    );
  });

  describe('sửa hồ sơ và đổi tình trạng', () => {
    it('FR-40: PATCH bằng …Code đổi cả id lẫn code; audit có fromCode/toCode; đổi dự án giữ đúng thứ tự', async () => {
      const detail = (await call('GET', `/crm/customers/${state.byCode}`)).body
        .data;
      const res = await call('PATCH', `/crm/customers/${state.byCode}`, {
        version: detail.version,
        sourceCode: sources[1].code,
        areaCode: areas[2].code,
        projectCodes: ['FR40C'],
      });
      expect(res.status).toBe(200);
      const raw = (await rawCustomer(state.byCode))!;
      expect(String(raw.sourceId)).toBe(sources[1].id);
      expect(raw.sourceCode).toBe(sources[1].code);
      expect(String(raw.areaId)).toBe(areas[2].id);
      expect(raw.areaCode).toBe(areas[2].code);
      expect(raw.interestedProjectIds.map(String)).toEqual([projects.FR40C.id]);
      expect(raw.interestedProjectCodes).toEqual(['FR40C']);

      const [entry] = await auditOf(state.byCode, 'CUSTOMER_UPDATED');
      const change = (field: string) =>
        entry.changes.find((c: any) => c.field === field);
      expect(change('source')).toMatchObject({
        fromCode: sources[0].code,
        toCode: sources[1].code,
      });
      expect(change('area')).toMatchObject({
        fromCode: areas[0].code,
        toCode: areas[2].code,
      });
      expect(change('projects')).toMatchObject({
        fromCode: ['FR40B', 'FR40A'],
        toCode: ['FR40C'],
      });
    });

    it('FR-40: PATCH xóa bằng null / mảng rỗng xóa cả id lẫn code', async () => {
      const detail = (await call('GET', `/crm/customers/${state.byCode}`)).body
        .data;
      const res = await call('PATCH', `/crm/customers/${state.byCode}`, {
        version: detail.version,
        sourceCode: null,
        areaCode: null,
        projectCodes: [],
      });
      expect(res.status).toBe(200);
      const raw = (await rawCustomer(state.byCode))!;
      expect(raw.sourceId).toBeNull();
      expect(raw.sourceCode).toBeNull();
      expect(raw.areaId).toBeNull();
      expect(raw.areaCode).toBeNull();
      expect(raw.interestedProjectIds).toEqual([]);
      expect(raw.interestedProjectCodes).toEqual([]);
    });

    it('FR-40: PATCH bằng …Id (cũ) cũng ghi kép; PATCH lệch id/code thì 400 và không đổi dữ liệu', async () => {
      const detail = (await call('GET', `/crm/customers/${state.byId}`)).body
        .data;
      const ok = await call('PATCH', `/crm/customers/${state.byId}`, {
        version: detail.version,
        sourceId: sources[0].id,
      });
      expect(ok.status).toBe(200);
      expect((await rawCustomer(state.byId))!.sourceCode).toBe(sources[0].code);

      const current = (await rawCustomer(state.byId))!;
      const bad = await call('PATCH', `/crm/customers/${state.byId}`, {
        version: current.__v,
        sourceId: sources[0].id,
        sourceCode: sources[1].code,
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe('VALIDATION_FAILED');
      const after = (await rawCustomer(state.byId))!;
      expect(after.sourceCode).toBe(sources[0].code);
      expect(after.__v).toBe(current.__v);
    });

    it('FR-40: đổi NHÃN danh mục không đổi code của khách; response trả nhãn mới cùng code cũ', async () => {
      await connection
        .collection('catalog_items')
        .updateOne(
          { _id: new Types.ObjectId(sources[0].id) },
          { $set: { label: 'Nhãn đã đổi tên' } },
        );
      const data = (await call('GET', `/crm/customers/${state.byId}`)).body
        .data;
      expect(data.source).toEqual({
        id: sources[0].id,
        code: sources[0].code,
        label: 'Nhãn đã đổi tên',
      });
      expect((await rawCustomer(state.byId))!.sourceCode).toBe(sources[0].code);
      await connection
        .collection('catalog_items')
        .updateOne(
          { _id: new Types.ObjectId(sources[0].id) },
          { $set: { label: sources[0].label } },
        );
    });

    it('FR-40: đổi tình trạng bằng statusCode ghi kép + audit fromCode/toCode; response status.code', async () => {
      const detail = (await call('GET', `/crm/customers/${state.byCode}`)).body
        .data;
      const res = await call('PATCH', `/crm/customers/${state.byCode}/status`, {
        statusCode: 'DROPPED',
        version: detail.version,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toMatchObject({ code: 'DROPPED' });
      const raw = (await rawCustomer(state.byCode))!;
      expect(String(raw.statusId)).toBe(statusId.DROPPED);
      expect(raw.statusCode).toBe('DROPPED');
      const [entry] = await auditOf(state.byCode, 'STATUS_CHANGED');
      expect(entry.changes[0]).toMatchObject({
        field: 'status',
        fromCode: 'INTERESTED',
        toCode: 'DROPPED',
      });
    });

    it('FR-40: đổi tình trạng bằng statusId (cũ) vẫn ghi statusCode', async () => {
      const current = (await rawCustomer(state.byCode))!;
      const res = await call('PATCH', `/crm/customers/${state.byCode}/status`, {
        statusId: statusId.INTERESTED,
        version: current.__v,
      });
      expect(res.status).toBe(200);
      expect((await rawCustomer(state.byCode))!.statusCode).toBe('INTERESTED');
    });

    it('FR-40: đổi tình trạng lệch id/code hoặc thiếu cả hai hoặc code lạ thì 400 và không đổi', async () => {
      const current = (await rawCustomer(state.byCode))!;
      for (const body of [
        { statusId: statusId.NET, statusCode: 'DROPPED' },
        {},
        { statusCode: 'KHONG_TON_TAI' },
      ]) {
        const res = await call(
          'PATCH',
          `/crm/customers/${state.byCode}/status`,
          {
            version: current.__v,
            ...body,
          },
        );
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      }
      const after = (await rawCustomer(state.byCode))!;
      expect(after.statusCode).toBe('INTERESTED');
      expect(after.__v).toBe(current.__v);
    });

    it('FR-40: tự đổi tình trạng (đủ 3/4 tiêu chí -> NET) ghi cả statusId lẫn statusCode, audit có fromCode/toCode', async () => {
      const created = await createCustomer({ statusCode: 'INTERESTED' });
      const id = created.body.data.id;
      const res = await call('PATCH', `/crm/customers/${id}/criteria`, {
        version: created.body.data.version,
        demand: { isDone: true },
        motivation: { isDone: true },
        finance: { isDone: true },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.autoStatusChange.to.code).toBe('NET');
      const raw = (await rawCustomer(id))!;
      expect(String(raw.statusId)).toBe(statusId.NET);
      expect(raw.statusCode).toBe('NET');
      const entries = await auditOf(id, 'STATUS_CHANGED');
      expect(entries).toHaveLength(1);
      expect(entries[0].changes[0]).toMatchObject({
        fromCode: 'INTERESTED',
        toCode: 'NET',
      });
    });

    it('FR-40: hàng loạt CHANGE_STATUS nhận payload.statusCode; lệch id/code hoặc thiếu cả hai thì 400', async () => {
      const spy = jest
        .spyOn(app.get(CrmRateLimitService), 'consume')
        .mockResolvedValue(undefined);
      try {
        const ok = await call('POST', '/crm/customer-bulk-operations', {
          type: 'CHANGE_STATUS',
          customerIds: [state.byId, state.both],
          payload: { statusCode: 'NET' },
        });
        expect(ok.status).toBe(200);
        expect(ok.body.data.succeeded.sort()).toEqual(
          [state.byId, state.both].sort(),
        );
        for (const id of [state.byId, state.both]) {
          const raw = (await rawCustomer(id))!;
          expect(String(raw.statusId)).toBe(statusId.NET);
          expect(raw.statusCode).toBe('NET');
        }
        for (const payload of [
          { statusId: statusId.NET, statusCode: 'DROPPED' },
          {},
        ]) {
          const bad = await call('POST', '/crm/customer-bulk-operations', {
            type: 'CHANGE_STATUS',
            customerIds: [state.byId],
            payload,
          });
          expect(bad.status).toBe(400);
          expect(bad.body.errorCode).toBe('VALIDATION_FAILED');
        }
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('lọc và đếm theo code (T-10)', () => {
    const idsOf = (res: Res): string[] =>
      res.body.data.map((item: any) => item.id).sort();

    beforeAll(async () => {
      // Dữ liệu riêng cho nhóm lọc: 3 khách có đủ id + code (qua API) và 1 khu vực con.
      const mk = async (extra: Record<string, unknown>) =>
        (await createCustomer(extra)).body.data.id as string;
      state.f1 = await mk({
        statusCode: 'DROPPED',
        sourceCode: sources[2].code,
        areaCode: areas[0].code,
        projectCodes: ['FR40A', 'FR40B'],
      });
      state.f2 = await mk({
        statusCode: 'DROPPED',
        sourceCode: sources[1].code,
        areaCode: areas[1].code,
        projectCodes: ['FR40C'],
      });
      state.f3 = await mk({
        statusCode: 'NOT_CONTACTED',
        sourceCode: sources[2].code,
        projectCodes: ['FR40B'],
      });
      const parent = areas[2];
      const childId = new Types.ObjectId();
      await connection.collection('areas').insertOne({
        _id: childId,
        name: 'Quận con FR40',
        code: 'QUAN_CON_FR40',
        parentId: new Types.ObjectId(parent.id),
        ancestorIds: [new Types.ObjectId(parent.id)],
        isActive: true,
        deletedAt: null,
      });
      state.childArea = { id: String(childId), code: 'QUAN_CON_FR40' };
      state.f4 = await mk({
        statusCode: 'INTERESTED',
        areaCode: state.childArea.code,
      });
    });

    it('FR-40: lọc statusCodes chỉ trả khách đúng tình trạng', async () => {
      const res = await call(
        'GET',
        '/crm/customers?statusCodes=DROPPED&limit=100',
      );
      expect(res.status).toBe(200);
      const found = idsOf(res);
      expect(found).toEqual(expect.arrayContaining([state.f1, state.f2]));
      expect(found).not.toContain(state.f3);
      expect(found).not.toContain(state.f4);
      for (const item of res.body.data)
        expect(item.status.code).toBe('DROPPED');
    });

    it('FR-40: lọc sourceCodes, projectCodes (chữ thường được chuẩn hóa), nhiều giá trị là HOẶC', async () => {
      const bySource = await call(
        'GET',
        `/crm/customers?sourceCodes=${sources[2].code}&limit=100`,
      );
      expect(idsOf(bySource)).toEqual(
        expect.arrayContaining([state.f1, state.f3, state.both]),
      );
      expect(idsOf(bySource)).not.toContain(state.f2);

      const byProject = await call(
        'GET',
        '/crm/customers?projectCodes=fr40b&limit=100',
      );
      expect(idsOf(byProject)).toEqual(
        expect.arrayContaining([state.f1, state.f3]),
      );
      expect(idsOf(byProject)).not.toContain(state.f2);

      const either = await call(
        'GET',
        '/crm/customers?projectCodes=FR40B,FR40C&limit=100',
      );
      expect(idsOf(either)).toEqual(
        expect.arrayContaining([state.f1, state.f2, state.f3]),
      );
    });

    it('FR-40: lọc areaCodes mở rộng sang khu vực con', async () => {
      const res = await call(
        'GET',
        `/crm/customers?areaCodes=${areas[2].code}&limit=100`,
      );
      expect(res.status).toBe(200);
      expect(idsOf(res)).toContain(state.f4);
      const own = await call(
        'GET',
        `/crm/customers?areaCodes=${state.childArea.code}&limit=100`,
      );
      expect(idsOf(own)).toEqual([state.f4]);
    });

    it('FR-40: tab listGroup kết hợp statusCodes (giao hai tập); mã không thuộc tab thì rỗng', async () => {
      const res = await call(
        'GET',
        '/crm/customers?listGroup=DROPPED&statusCodes=DROPPED,NET&limit=100',
      );
      expect(idsOf(res)).toEqual(expect.arrayContaining([state.f1, state.f2]));
      for (const item of res.body.data)
        expect(item.status.code).toBe('DROPPED');
      const none = await call(
        'GET',
        '/crm/customers?listGroup=DROPPED&statusCodes=NET',
      );
      expect(none.body.data).toEqual([]);
    });

    it('FR-40: bộ lọc cũ …Ids vẫn hoạt động; id + code cùng tập thì chấp nhận, lệch tập thì 400', async () => {
      const legacy = await call(
        'GET',
        `/crm/customers?statusIds=${statusId.DROPPED}&limit=100`,
      );
      expect(idsOf(legacy)).toEqual(
        expect.arrayContaining([state.f1, state.f2]),
      );
      const same = await call(
        'GET',
        `/crm/customers?statusIds=${statusId.DROPPED}&statusCodes=DROPPED`,
      );
      expect(same.status).toBe(200);
      const bad = await call(
        'GET',
        `/crm/customers?statusIds=${statusId.DROPPED}&statusCodes=NET`,
      );
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe('VALIDATION_FAILED');
      const badSource = await call(
        'GET',
        `/crm/customers?sourceIds=${sources[0].id}&sourceCodes=${sources[1].code}`,
      );
      expect(badSource.status).toBe(400);
    });

    it('FR-40: list-counts trả byStatus[].statusCode, tổng byStatus và các tab bằng số khách không xóa', async () => {
      // Một khách đã xóa mềm không được đếm.
      const deleted = await createCustomer({ statusCode: 'DROPPED' });
      await connection
        .collection('customers')
        .updateOne(
          { _id: new Types.ObjectId(deleted.body.data.id) },
          { $set: { deletedAt: new Date() } },
        );
      const live = await connection
        .collection('customers')
        .countDocuments({ deletedAt: null });

      const res = await call('GET', '/crm/customers/list-counts');
      expect(res.status).toBe(200);
      const counts = res.body.data;
      const sum = counts.byStatus.reduce(
        (acc: number, row: any) => acc + row.count,
        0,
      );
      expect(sum).toBe(live);
      expect(counts.ALL).toBe(live);
      expect(
        counts.NOT_CONTACTED + counts.INTERESTED + counts.NET + counts.DROPPED,
      ).toBe(live);
      for (const row of counts.byStatus) {
        expect(row.statusId).toBe(statusId[row.statusCode]);
        expect(typeof row.statusCode).toBe('string');
      }
      const dropped = counts.byStatus.find(
        (r: any) => r.statusCode === 'DROPPED',
      );
      expect(dropped.count).toBe(counts.DROPPED);
    });

    it('FR-40: list-counts theo bộ lọc mã khớp danh sách cùng bộ lọc', async () => {
      const list = await call(
        'GET',
        '/crm/customers?projectCodes=FR40B&limit=100',
      );
      const counts = await call(
        'GET',
        '/crm/customers/list-counts?projectCodes=FR40B',
      );
      expect(counts.body.data.ALL).toBe(list.body.meta.total);
    });

    it('FR-40: hợp đồng 4.2: source/area/projects có { id, code, label }, status có code, byStatus có cả statusId lẫn statusCode', async () => {
      const list = await call(
        'GET',
        `/crm/customers?projectCodes=FR40B&limit=100`,
      );
      const item = list.body.data.find((row: any) => row.id === state.f1);
      expect(Object.keys(item.source).sort()).toEqual(['code', 'id', 'label']);
      expect(Object.keys(item.area).sort()).toEqual(['code', 'id', 'label']);
      for (const project of item.projects) {
        expect(Object.keys(project).sort()).toEqual(['code', 'id', 'label']);
      }
      expect(typeof item.status.code).toBe('string');
      const counts = await call('GET', '/crm/customers/list-counts');
      expect(Object.keys(counts.body.data.byStatus[0]).sort()).toEqual([
        'count',
        'statusCode',
        'statusId',
      ]);
    });

    it('FR-40: query …Codes sai định dạng (rỗng, quá dài) thì 400; toán tử $ vẫn bị chặn', async () => {
      const long = 'A'.repeat(61);
      expect(
        (await call('GET', `/crm/customers?statusCodes=${long}`)).status,
      ).toBe(400);
      expect(
        (await call('GET', '/crm/customers?projectCodes[$ne]=x')).status,
      ).toBe(400);
    });
  });

  describe('bản ghi thiếu code (kiểu image v1.0.3 ghi) và đếm dự án', () => {
    it('FR-40: khách chỉ có id (chưa backfill code) VẪN lọt vào lọc theo sourceCodes/projectCodes nhờ nhánh id song song (5.1.8a), không lặp, và được đếm trong list-counts, hiển thị đủ code', async () => {
      const legacyId = await insertLegacyCustomer({
        sourceId: new Types.ObjectId(sources[2].id),
        interestedProjectIds: [new Types.ObjectId(projects.FR40A.id)],
      });
      state.legacy = legacyId;

      const byCode = await call(
        'GET',
        `/crm/customers?projectCodes=FR40A&limit=100`,
      );
      const byCodeIds = byCode.body.data.map((r: any) => r.id);
      expect(byCodeIds).toContain(legacyId);
      expect(new Set(byCodeIds).size).toBe(byCodeIds.length);
      const bySourceCode = await call(
        'GET',
        `/crm/customers?sourceCodes=${sources[2].code}&limit=100`,
      );
      const bySourceIds = bySourceCode.body.data.map((r: any) => r.id);
      expect(bySourceIds).toContain(legacyId);
      expect(new Set(bySourceIds).size).toBe(bySourceIds.length);
      const byLegacyId = await call(
        'GET',
        `/crm/customers?projectIds=${projects.FR40A.id}&limit=100`,
      );
      expect(byLegacyId.body.data.map((r: any) => r.id)).toContain(legacyId);

      const live = await connection
        .collection('customers')
        .countDocuments({ deletedAt: null });
      const counts = (await call('GET', '/crm/customers/list-counts')).body
        .data;
      expect(counts.ALL).toBe(live);
      const interested = counts.byStatus.find(
        (r: any) => r.statusCode === 'INTERESTED',
      );
      expect(interested.statusId).toBe(statusId.INTERESTED);
      expect(interested.count).toBe(counts.INTERESTED);

      const detail = (await call('GET', `/crm/customers/${legacyId}`)).body
        .data;
      expect(detail.source).toMatchObject({ code: sources[2].code });
      expect(detail.projects).toEqual([
        expect.objectContaining({ code: 'FR40A' }),
      ]);
    });

    it('FR-40: sửa hồ sơ khách thiếu code điền luôn code ở lần ghi (tự lành), kể cả khi chỉ đổi tên', async () => {
      const res = await call('PATCH', `/crm/customers/${state.legacy}`, {
        version: 0,
        fullName: 'Khách cũ đã sửa',
      });
      expect(res.status).toBe(200);
      const healed = (await rawCustomer(state.legacy))!;
      expect(healed.sourceCode).toBe(sources[2].code);
      expect(healed.areaCode).toBeNull();
      expect(healed.interestedProjectCodes).toEqual(['FR40A']);
    });

    it('FR-40: countActiveCustomersByProjects đếm id-hoặc-code, không đếm trùng khách có cả hai, bỏ khách đã xóa mềm', async () => {
      const usage = app.get(CrmUsageService, { strict: false });
      const oid = (id: string) => new Types.ObjectId(id);
      const fresh = {
        P1: await createProject('FR40CNT1'),
        P2: await createProject('FR40CNT2'),
      };
      // Chỉ có id (thiếu code).
      await insertLegacyCustomer({ interestedProjectIds: [oid(fresh.P1.id)] });
      // Chỉ có code (thiếu id).
      await insertLegacyCustomer({ interestedProjectCodes: ['FR40CNT1'] });
      // Có cả id lẫn code của CÙNG dự án: đếm một lần.
      await insertLegacyCustomer({
        interestedProjectIds: [oid(fresh.P1.id)],
        interestedProjectCodes: ['FR40CNT1'],
      });
      // Hỗn hợp: P1 chỉ bằng id; P2 bằng cả id lẫn code.
      await insertLegacyCustomer({
        interestedProjectIds: [oid(fresh.P1.id), oid(fresh.P2.id)],
        interestedProjectCodes: ['FR40CNT2'],
      });
      // Khách này khớp P1 bằng id và P2 bằng code (hai dự án khác nhau, mỗi dự án đếm một lần).
      await insertLegacyCustomer({
        interestedProjectIds: [oid(fresh.P1.id)],
        interestedProjectCodes: ['FR40CNT2'],
      });
      // Khách đã xóa mềm không được đếm.
      await insertLegacyCustomer({
        interestedProjectIds: [oid(fresh.P1.id)],
        interestedProjectCodes: ['FR40CNT1'],
        deletedAt: new Date(),
      });

      const counts = await usage.countActiveCustomersByProjects([
        { _id: oid(fresh.P1.id), codeNormalized: 'FR40CNT1' },
        { _id: oid(fresh.P2.id), codeNormalized: 'FR40CNT2' },
      ]);
      expect(counts.get(fresh.P1.id)).toBe(5);
      expect(counts.get(fresh.P2.id)).toBe(2);

      // Dự án không có mã (dữ liệu cũ) vẫn đếm theo id.
      const idOnly = await usage.countActiveCustomersByProjects([
        { _id: oid(fresh.P1.id) },
      ]);
      expect(idOnly.get(fresh.P1.id)).toBe(4);

      // GET /crm/projects trả customerCount theo cùng quy tắc.
      const list = await call('GET', '/crm/projects?limit=100');
      const row = list.body.data.find((p: any) => p.id === fresh.P1.id);
      expect(row.customerCount).toBe(5);
    });

    it('FR-40: tab listGroup và statusCodes VẪN hiện khách chưa backfill statusCode (chỉ có statusId), đúng tab của tình trạng đó', async () => {
      const legacyDropped = await insertLegacyCustomer({
        statusId: new Types.ObjectId(statusId.DROPPED),
      });
      const legacyInterested = await insertLegacyCustomer({
        statusId: new Types.ObjectId(statusId.INTERESTED),
      });
      const idsIn = async (query: string): Promise<string[]> =>
        (await call('GET', `/crm/customers?${query}&limit=100`)).body.data.map(
          (item: any) => item.id,
        );

      const droppedTab = await idsIn('listGroup=DROPPED');
      expect(droppedTab).toContain(legacyDropped);
      expect(droppedTab).not.toContain(legacyInterested);

      const interestedTab = await idsIn('listGroup=INTERESTED');
      expect(interestedTab).toContain(legacyInterested);
      expect(interestedTab).not.toContain(legacyDropped);

      // Giao tab với statusCodes, và statusCodes một mình (không tab) cũng giữ nhánh dự phòng theo id.
      expect(await idsIn('listGroup=DROPPED&statusCodes=DROPPED')).toContain(
        legacyDropped,
      );
      expect(await idsIn('statusCodes=INTERESTED')).toContain(legacyInterested);
      expect(await idsIn('listGroup=DROPPED&statusCodes=NET')).toEqual([]);

      // Số đếm tab khớp số khách thật của tab (đều tính cả khách chưa backfill).
      const counts = (await call('GET', '/crm/customers/list-counts')).body
        .data;
      const total = (await call('GET', '/crm/customers?listGroup=DROPPED')).body
        .meta.total;
      expect(total).toBe(counts.DROPPED);
    });
  });

  const createProject = async (code: string) => {
    const res = await call('POST', '/crm/projects', {
      name: `Dự án ${code}`,
      code,
    });
    expect(res.status).toBe(201);
    return { id: res.body.data.id as string, code };
  };
});
