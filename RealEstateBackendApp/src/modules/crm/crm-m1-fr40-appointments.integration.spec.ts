/**
 * INTEGRATION — FR-40 (T-12): lịch hẹn tham chiếu dự án theo `code` (ghi kép `projectId` + `projectCode`), response
 * `CatalogRefDto`, lọc lịch theo `projectCode`/`projectId`, việc hôm nay và quét nhắc việc lọc tình trạng theo
 * `statusCode`. HTTP thật (Fastify + ValidationPipe `forbidNonWhitelisted` + GlobalExceptionFilter + guard) trên
 * MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis/MinIO (giống `crm-m1.integration.spec.ts`).
 *
 * Các `it` trong cùng `describe` chạy THEO THỨ TỰ và dùng chung dữ liệu dựng ở `beforeAll`.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
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
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { vnDateKey } from '../../common/utils/timezone.util';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { ReminderScannerService } from './reminders/reminder-scanner.service';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

type Res = { status: number; body: any };

describe('FR-40 T-12 — lịch hẹn theo projectCode, việc hôm nay/quét nhắc theo statusCode', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let scanner: ReminderScannerService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let customerId: string;
  let projectA: { id: string; code: string; label: string };
  let projectB: { id: string; code: string; label: string };
  let projectOff: { id: string; code: string; label: string };

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  };

  const createUser = async (key: string, role: UserRole) => {
    const user = await userModel.create({
      email: `${key}@fr40.vn`,
      password: 'hash',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

  let phoneSeq = 0;
  const createCustomer = async (): Promise<string> => {
    const res = await call('POST', '/crm/customers', 'staffA', {
      fullName: `Khách FR40-${++phoneSeq}`,
      phone: `095${String(1_000_000 + phoneSeq)}`,
    });
    expect([res.status, res.body.message]).toEqual([201, undefined]);
    return res.body.data.id;
  };

  const col = (name: string) => connection.collection(name);
  const oid = (id: string) => new Types.ObjectId(id);
  const inDays = (days: number) =>
    new Date(Date.now() + days * DAY_MS).toISOString();

  const createAppointment = (extra: Record<string, unknown> = {}) =>
    call('POST', '/crm/appointments', 'staffA', {
      customerId,
      type: 'SITE_VISIT',
      startAt: inDays(3),
      ...extra,
    });

  const createProject = async (code: string, name: string) => {
    const res = await call('POST', '/crm/projects', 'admin', { name, code });
    expect(res.status).toBe(201);
    return { id: res.body.data.id as string, code, label: name };
  };

  const codeRef = (project: { id: string; code: string; label: string }) => ({
    id: project.id,
    code: project.code,
    label: project.label,
  });

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-fr40-t12-${Date.now()}:`;
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
    scanner = app.get(ReminderScannerService);

    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('staffA', UserRole.STAFF);

    customerId = await createCustomer();
    projectA = await createProject('FR40TERRA', 'Dự án Terra FR40');
    projectB = await createProject('FR40VINH', 'Dự án Vinh FR40');
    projectOff = await createProject('FR40OFF', 'Dự án Ngừng FR40');
    const off = await call('PATCH', `/crm/projects/${projectOff.id}`, 'admin', {
      isActive: false,
    });
    expect(off.status).toBe(200);
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  it('FR-40: index { projectCode, startAt } có trên collection appointments', async () => {
    const indexes = await col('appointments').indexes();
    expect(indexes.map((index) => index.key)).toContainEqual({
      projectCode: 1,
      startAt: 1,
    });
  });

  it('FR-40: tạo lịch bằng projectCode (chữ thường) ghi KÉP projectId + projectCode, response project { id, code, label }, audit ghi nhãn', async () => {
    const res = await createAppointment({
      projectCode: projectA.code.toLowerCase(),
    });
    expect([res.status, res.body.message]).toEqual([201, undefined]);
    expect(res.body.data.project).toEqual(codeRef(projectA));
    const doc = await col('appointments').findOne({
      _id: oid(res.body.data.id),
    });
    expect(String(doc!.projectId)).toBe(projectA.id);
    expect(doc!.projectCode).toBe(projectA.code);
    const audit = await col('crm_audit_logs').findOne({
      action: 'APPOINTMENT_CREATED',
      entityId: oid(res.body.data.id),
    });
    expect(audit!.changes).toContainEqual({
      field: 'appointment.project',
      from: null,
      to: projectA.label,
    });
    const detail = await call(
      'GET',
      `/crm/appointments/${res.body.data.id}`,
      'staffA',
    );
    expect(detail.body.data.project).toEqual(codeRef(projectA));
  });

  it('FR-40 (tương thích PWA cũ): chỉ gửi projectId vẫn ghi kép projectCode; không gửi gì hoặc null => cả hai null', async () => {
    const byId = await createAppointment({ projectId: projectB.id });
    expect([byId.status, byId.body.data.project]).toEqual([
      201,
      codeRef(projectB),
    ]);
    const doc = await col('appointments').findOne({
      _id: oid(byId.body.data.id),
    });
    expect([String(doc!.projectId), doc!.projectCode]).toEqual([
      projectB.id,
      projectB.code,
    ]);

    for (const extra of [{}, { projectId: null }, { projectCode: null }]) {
      const res = await createAppointment(extra);
      expect([res.status, res.body.data.project]).toEqual([201, null]);
      const row = await col('appointments').findOne({
        _id: oid(res.body.data.id),
      });
      expect([row!.projectId, row!.projectCode]).toEqual([null, null]);
    }
  });

  it('FR-40: gửi cả hai cùng dự án thì nhận; id và code khác dự án, hoặc null cạnh giá trị => 400 VALIDATION_FAILED và KHÔNG tạo lịch', async () => {
    const same = await createAppointment({
      projectId: projectA.id,
      projectCode: projectA.code,
    });
    expect(same.status).toBe(201);

    const before = await col('appointments').countDocuments({
      customerId: oid(customerId),
    });
    for (const extra of [
      { projectId: projectA.id, projectCode: projectB.code },
      { projectId: null, projectCode: projectA.code },
      { projectId: projectA.id, projectCode: null },
    ]) {
      const res = await createAppointment(extra);
      expect([res.status, res.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
    expect(
      await col('appointments').countDocuments({ customerId: oid(customerId) }),
    ).toBe(before);
  });

  it('FR-40: projectCode không tồn tại / đã ngừng hoạt động => 400 VALIDATION_FAILED (field projectCode); mã sai định dạng => 400', async () => {
    for (const projectCode of ['KHONGCO', projectOff.code]) {
      const res = await createAppointment({ projectCode });
      expect([res.status, res.body.errorCode, res.body.details?.field]).toEqual(
        [400, 'VALIDATION_FAILED', 'projectCode'],
      );
    }
    expect((await createAppointment({ projectCode: 'sai mã' })).status).toBe(
      400,
    );
  });

  it('FR-40: sửa lịch đổi dự án bằng projectCode ghi kép; gỡ bằng null; bỏ trống giữ nguyên; gửi lại dự án đã ngừng không bị chặn nhưng không đổi sang dự án ngừng', async () => {
    const created = await createAppointment({ projectCode: projectA.code });
    const url = `/crm/appointments/${created.body.data.id}`;
    const stored = () =>
      col('appointments').findOne({ _id: oid(created.body.data.id) });

    const keep = await call('PATCH', url, 'staffA', { title: 'Đổi tiêu đề' });
    expect(keep.body.data.project).toEqual(codeRef(projectA));

    const swap = await call('PATCH', url, 'staffA', {
      projectCode: projectB.code,
    });
    expect(swap.body.data.project).toEqual(codeRef(projectB));
    const afterSwap = await stored();
    expect([String(afterSwap!.projectId), afterSwap!.projectCode]).toEqual([
      projectB.id,
      projectB.code,
    ]);
    const audit = await col('crm_audit_logs')
      .find({
        action: 'APPOINTMENT_UPDATED',
        entityId: oid(created.body.data.id),
      })
      .toArray();
    expect(audit.flatMap((row) => row.changes)).toContainEqual({
      field: 'appointment.project',
      from: projectA.label,
      to: projectB.label,
    });

    const rejected = await call('PATCH', url, 'staffA', {
      projectCode: projectOff.code,
    });
    expect([
      rejected.status,
      rejected.body.errorCode,
      rejected.body.details?.field,
    ]).toEqual([400, 'VALIDATION_FAILED', 'projectCode']);
    const mismatch = await call('PATCH', url, 'staffA', {
      projectId: projectA.id,
      projectCode: projectB.code,
    });
    expect([mismatch.status, mismatch.body.errorCode]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);

    await call('PATCH', `/crm/projects/${projectB.id}`, 'admin', {
      isActive: false,
    });
    const resend = await call('PATCH', url, 'staffA', {
      projectCode: projectB.code.toLowerCase(),
      note: 'ghi chú',
    });
    expect([resend.status, resend.body.data.project?.code]).toEqual([
      200,
      projectB.code,
    ]);
    await call('PATCH', `/crm/projects/${projectB.id}`, 'admin', {
      isActive: true,
    });

    const cleared = await call('PATCH', url, 'staffA', { projectCode: null });
    expect([cleared.status, cleared.body.data.project]).toEqual([200, null]);
    const afterClear = await stored();
    expect([afterClear!.projectId, afterClear!.projectCode]).toEqual([
      null,
      null,
    ]);
  });

  it('FR-40: dự án của lịch bị xóa mềm hoặc xóa cứng ngoài ứng dụng thì gửi lại đúng projectCode/projectId đang lưu vẫn 200 (không đổi), đổi sang dự án khác vẫn kiểm bình thường', async () => {
    const soft = await createProject('FR40SOFT', 'Dự án xóa mềm FR40');
    const hard = await createProject('FR40HARD', 'Dự án xóa cứng FR40');
    const softAppt = await createAppointment({ projectCode: soft.code });
    const hardAppt = await createAppointment({ projectCode: hard.code });
    await col('projects').updateOne(
      { _id: oid(soft.id) },
      { $set: { deletedAt: new Date() } },
    );
    await col('projects').deleteOne({ _id: oid(hard.id) });

    const softByCode = await call(
      'PATCH',
      `/crm/appointments/${softAppt.body.data.id}`,
      'staffA',
      { projectCode: soft.code.toLowerCase(), note: 'a' },
    );
    const hardByCode = await call(
      'PATCH',
      `/crm/appointments/${hardAppt.body.data.id}`,
      'staffA',
      { projectCode: hard.code, note: 'b' },
    );
    const hardById = await call(
      'PATCH',
      `/crm/appointments/${hardAppt.body.data.id}`,
      'staffA',
      { projectId: hard.id, note: 'c' },
    );
    expect([softByCode.status, hardByCode.status, hardById.status]).toEqual([
      200, 200, 200,
    ]);
    const stored = await col('appointments').findOne({
      _id: oid(hardAppt.body.data.id),
    });
    expect([String(stored!.projectId), stored!.projectCode]).toEqual([
      hard.id,
      hard.code,
    ]);

    const swap = await call(
      'PATCH',
      `/crm/appointments/${hardAppt.body.data.id}`,
      'staffA',
      { projectCode: projectA.code },
    );
    expect([swap.status, swap.body.data.project?.code]).toEqual([
      200,
      projectA.code,
    ]);
    const gone = await call(
      'PATCH',
      `/crm/appointments/${softAppt.body.data.id}`,
      'staffA',
      { projectCode: hard.code },
    );
    expect([gone.status, gone.body.errorCode]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  });

  it('FR-40: lọc danh sách theo projectCode (không phân biệt hoa thường) và theo projectId (cũ) cùng trả đúng lịch của dự án; id/code lệch => 400', async () => {
    const only = await createProject('FR40ONLY', 'Dự án riêng FR40');
    const withProject = await createAppointment({ projectCode: only.code });
    await createAppointment({ projectCode: projectA.code });
    await createAppointment();
    const range = `from=${inDays(-1).slice(0, 10)}&to=${inDays(10).slice(0, 10)}&limit=100`;

    const byCode = await call(
      'GET',
      `/crm/appointments?${range}&projectCode=${only.code.toLowerCase()}`,
      'staffA',
    );
    expect(byCode.status).toBe(200);
    expect(byCode.body.data.map((item: any) => item.id)).toEqual([
      withProject.body.data.id,
    ]);
    expect(byCode.body.meta.total).toBe(1);
    expect(byCode.body.data[0].project).toEqual(codeRef(only));

    const byId = await call(
      'GET',
      `/crm/appointments?${range}&projectId=${only.id}`,
      'staffA',
    );
    expect(byId.body.data.map((item: any) => item.id)).toEqual([
      withProject.body.data.id,
    ]);

    const both = await call(
      'GET',
      `/crm/appointments?${range}&projectId=${only.id}&projectCode=${only.code}`,
      'staffA',
    );
    expect(both.body.data).toHaveLength(1);

    const mismatch = await call(
      'GET',
      `/crm/appointments?${range}&projectId=${only.id}&projectCode=${projectA.code}`,
      'staffA',
    );
    expect([mismatch.status, mismatch.body.errorCode]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    const badCode = await call(
      'GET',
      `/crm/appointments?${range}&projectCode=sai%20m%C3%A3`,
      'staffA',
    );
    expect(badCode.status).toBe(400);
  });

  it('FR-40: lọc theo projectCode VẪN trả lịch chưa backfill projectCode (chỉ có projectId) của đúng dự án, không lẫn dự án khác', async () => {
    const proj = await createProject('FR40LEGACY', 'Dự án lịch cũ FR40');
    const created = await createAppointment({ projectCode: proj.code });
    const other = await createAppointment({ projectCode: projectA.code });
    await col('appointments').updateOne(
      { _id: oid(created.body.data.id) },
      { $unset: { projectCode: '' } },
    );
    await col('appointments').updateOne(
      { _id: oid(other.body.data.id) },
      { $unset: { projectCode: '' } },
    );
    const range = `from=${inDays(-1).slice(0, 10)}&to=${inDays(10).slice(0, 10)}&limit=100`;

    const res = await call(
      'GET',
      `/crm/appointments?${range}&projectCode=${proj.code.toLowerCase()}`,
      'staffA',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.map((item: any) => item.id)).toEqual([
      created.body.data.id,
    ]);
  });

  it('FR-40: Việc hôm nay trả project { id, code, label } của lịch và customer.projects theo mã khách quan tâm', async () => {
    const cust = await createCustomer();
    await col('customers').updateOne(
      { _id: oid(cust) },
      {
        $set: {
          interestedProjectIds: [oid(projectA.id)],
          interestedProjectCodes: [projectA.code],
        },
      },
    );
    const created = await call('POST', '/crm/appointments', 'staffA', {
      customerId: cust,
      type: 'MEETING',
      startAt: inDays(1),
      title: 'Hẹn FR40 việc hôm nay',
      projectCode: projectB.code,
    });
    expect(created.status).toBe(201);

    const res = await call(
      'GET',
      '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
      'staffA',
    );
    const task = res.body.data.find(
      (item: any) => item.appointmentId === created.body.data.id,
    );
    expect(task.project).toEqual(codeRef(projectB));
    expect(task.customer.projects).toEqual([codeRef(projectA)]);
  });

  describe('lọc tình trạng theo statusCode', () => {
    const old = new Date(Date.now() - 30 * DAY_MS);

    /** Khách có `statusCode` (field mới) đặt thẳng vào DB để không phụ thuộc đường ghi của module khách. */
    const customerWithStatus = async (statusCode: string) => {
      const id = await createCustomer();
      const status = await col('customer_statuses').findOne({
        code: statusCode,
      });
      await col('customers').updateOne(
        { _id: oid(id) },
        {
          $set: {
            statusId: status!._id,
            statusCode,
            lastCareLogAt: old,
            createdAt: old,
          },
        },
      );
      return id;
    };

    it('FR-40: Việc hôm nay (khách lâu chưa chăm sóc) chỉ gồm khách có statusCode thuộc nhóm Chưa tiếp cận/Có quan tâm', async () => {
      const stale = await customerWithStatus('INTERESTED');
      const dropped = await customerWithStatus('DROPPED');
      const net = await customerWithStatus('NET');

      const res = await call(
        'GET',
        '/crm/daily-tasks?kinds=STALE_CUSTOMER&limit=100',
        'staffA',
      );
      const customers = res.body.data.map((task: any) => task.customer.id);
      expect(customers).toContain(stale);
      expect(customers).not.toContain(dropped);
      expect(customers).not.toContain(net);
    });

    it('FR-40: quét nhắc khách lâu chưa chăm sóc chỉ tạo nhắc cho khách có statusCode thuộc Chưa tiếp cận/Có quan tâm', async () => {
      const stale = await customerWithStatus('NOT_CONTACTED');
      const dropped = await customerWithStatus('DROPPED');

      await scanner.scanStale(new Date());

      const reminders = await col('reminders')
        .find({
          type: 'STALE_CUSTOMER',
          customerId: { $in: [oid(stale), oid(dropped)] },
        })
        .toArray();
      expect(reminders.map((row) => String(row.customerId))).toEqual([stale]);
    });

    describe('khách CHƯA backfill statusCode (thiếu field, chỉ có statusId)', () => {
      const [, month, day] = vnDateKey(new Date()).split('-').map(Number);

      /** Khách kiểu dữ liệu cũ: có `statusId` nhưng KHÔNG có `statusCode` (xóa thẳng khỏi DB). */
      const customerWithoutStatusCode = async (
        statusCode: string,
        extra: Record<string, unknown> = {},
      ) => {
        const id = await createCustomer();
        const status = await col('customer_statuses').findOne({
          code: statusCode,
        });
        await col('customers').updateOne(
          { _id: oid(id) },
          {
            $set: { statusId: status!._id, ...extra },
            $unset: { statusCode: '' },
          },
        );
        expect(
          (await col('customers').findOne({ _id: oid(id) }))!,
        ).not.toHaveProperty('statusCode');
        return id;
      };
      const today = { occasions: [{ fieldKey: 'birthday', month, day }] };

      it('FR-40: Việc hôm nay (dịp đặc biệt) KHÔNG lấy khách "Bỏ" thiếu statusCode, vẫn lấy khách thiếu statusCode ở tình trạng khác', async () => {
        const dropped = await customerWithoutStatusCode('DROPPED', today);
        const active = await customerWithoutStatusCode('INTERESTED', today);

        const res = await call(
          'GET',
          '/crm/daily-tasks?kinds=OCCASION&limit=100',
          'staffA',
        );
        const customers = res.body.data.map((task: any) => task.customer.id);
        expect(customers).toContain(active);
        expect(customers).not.toContain(dropped);
      });

      it('FR-40: quét nhắc dịp đặc biệt KHÔNG tạo nhắc cho khách "Bỏ" thiếu statusCode, vẫn tạo cho khách thiếu statusCode ở tình trạng khác', async () => {
        const dropped = await customerWithoutStatusCode('DROPPED', today);
        const active = await customerWithoutStatusCode('NOT_CONTACTED', today);

        await scanner.scanOccasions(new Date());

        const reminders = await col('reminders')
          .find({
            type: 'OCCASION',
            customerId: { $in: [oid(active), oid(dropped)] },
          })
          .toArray();
        expect(reminders.map((row) => String(row.customerId))).toEqual([
          active,
        ]);
      });

      it('FR-40: Việc hôm nay (khách lâu chưa chăm sóc) VẪN lấy khách thiếu statusCode thuộc Chưa tiếp cận/Có quan tâm, bỏ khách Bỏ/NET thiếu statusCode', async () => {
        const old = { lastCareLogAt: new Date(Date.now() - 30 * DAY_MS) };
        const stale = await customerWithoutStatusCode('INTERESTED', old);
        const dropped = await customerWithoutStatusCode('DROPPED', old);
        const net = await customerWithoutStatusCode('NET', old);

        const res = await call(
          'GET',
          '/crm/daily-tasks?kinds=STALE_CUSTOMER&limit=100',
          'staffA',
        );
        const customers = res.body.data.map((task: any) => task.customer.id);
        expect(customers).toContain(stale);
        expect(customers).not.toContain(dropped);
        expect(customers).not.toContain(net);
      });

      it('FR-40: quét nhắc khách lâu chưa chăm sóc VẪN tạo nhắc cho khách thiếu statusCode thuộc Chưa tiếp cận/Có quan tâm, không tạo cho khách Bỏ', async () => {
        const old = { lastCareLogAt: new Date(Date.now() - 30 * DAY_MS) };
        const stale = await customerWithoutStatusCode('NOT_CONTACTED', old);
        const dropped = await customerWithoutStatusCode('DROPPED', old);
        await col('customers').updateMany(
          { _id: { $in: [oid(stale), oid(dropped)] } },
          { $set: { primaryAssigneeId: oid(ids.staffA) } },
        );

        await scanner.scanStale(new Date());

        const reminders = await col('reminders')
          .find({
            type: 'STALE_CUSTOMER',
            customerId: { $in: [oid(stale), oid(dropped)] },
          })
          .toArray();
        expect(reminders.map((row) => String(row.customerId))).toEqual([stale]);
      });
    });
  });

  describe('FR-40 T-11: nhật ký chăm sóc ghi kép contactResultId + contactResultCode qua HTTP', () => {
    const careLogsUrl = () => `/crm/customers/${customerId}/care-logs`;
    const contactResult = async (code: string) => {
      const item = await col('catalog_items').findOne({
        type: 'CONTACT_RESULT',
        code,
      });
      return { id: String(item!._id), code, label: item!.label as string };
    };
    const storedLog = (id: string) =>
      col('care_logs').findOne({ _id: oid(id) });
    const createLog = (extra: Record<string, unknown> = {}) =>
      call('POST', careLogsUrl(), 'staffA', {
        content: 'Gọi tư vấn',
        contactChannel: 'CALL',
        ...extra,
      });

    it('FR-40: tạo bằng contactResultCode ghi KÉP id + code, response contactResult { id, code, label }; chỉ gửi contactResultId (PWA cũ) vẫn ghi kép; không gửi thì null', async () => {
      const price = await contactResult('PRICE_QUOTE');
      const noAnswer = await contactResult('NO_ANSWER');

      const byCode = await createLog({ contactResultCode: price.code });
      expect([byCode.status, byCode.body.message]).toEqual([201, undefined]);
      expect(byCode.body.data.contactResult).toEqual(price);
      const doc = await storedLog(byCode.body.data.id);
      expect([String(doc!.contactResultId), doc!.contactResultCode]).toEqual([
        price.id,
        price.code,
      ]);

      const byId = await createLog({ contactResultId: noAnswer.id });
      expect([byId.status, byId.body.data.contactResult]).toEqual([
        201,
        noAnswer,
      ]);
      const idDoc = await storedLog(byId.body.data.id);
      expect([
        String(idDoc!.contactResultId),
        idDoc!.contactResultCode,
      ]).toEqual([noAnswer.id, noAnswer.code]);

      const none = await createLog();
      expect([none.status, none.body.data.contactResult]).toEqual([201, null]);
      const noneDoc = await storedLog(none.body.data.id);
      expect([noneDoc!.contactResultId, noneDoc!.contactResultCode]).toEqual([
        null,
        null,
      ]);
    });

    it('FR-40: tạo với id và code khác bản ghi, mã không tồn tại hoặc sai định dạng (chữ thường) => 400 VALIDATION_FAILED và KHÔNG tạo nhật ký', async () => {
      const price = await contactResult('PRICE_QUOTE');
      const noAnswer = await contactResult('NO_ANSWER');
      const before = await col('care_logs').countDocuments({
        customerId: oid(customerId),
      });

      const cases: Array<[Record<string, unknown>, string | undefined]> = [
        [
          { contactResultId: price.id, contactResultCode: noAnswer.code },
          'contactResultCode',
        ],
        [{ contactResultCode: 'KHONG_TON_TAI' }, 'contactResultCode'],
        // Sai định dạng bị DTO chặn trước (không có details.field).
        [{ contactResultCode: 'price_quote' }, undefined],
      ];
      for (const [extra, field] of cases) {
        const res = await createLog(extra);
        expect([
          res.status,
          res.body.errorCode,
          res.body.details?.field,
        ]).toEqual([400, 'VALIDATION_FAILED', field]);
      }
      expect(
        await col('care_logs').countDocuments({ customerId: oid(customerId) }),
      ).toBe(before);
    });

    it('FR-40: PATCH đổi bằng contactResultCode ghi kép + audit; gửi lại đúng mã đang lưu là không đổi (200); null gỡ cả hai; mã sai => 400 và giữ nguyên', async () => {
      const price = await contactResult('PRICE_QUOTE');
      const noAnswer = await contactResult('NO_ANSWER');
      const created = await createLog({ contactResultCode: price.code });
      const logId = created.body.data.id as string;
      const url = `${careLogsUrl()}/${logId}`;
      const pair = async () => {
        const doc = await storedLog(logId);
        return [String(doc!.contactResultId), doc!.contactResultCode];
      };

      const swap = await call('PATCH', url, 'staffA', {
        contactResultCode: noAnswer.code,
      });
      expect([swap.status, swap.body.data.contactResult]).toEqual([
        200,
        noAnswer,
      ]);
      expect(await pair()).toEqual([noAnswer.id, noAnswer.code]);
      const audit = await col('crm_audit_logs')
        .find({ action: 'CARE_LOG_UPDATED', entityId: oid(logId) })
        .toArray();
      expect(audit.flatMap((row) => row.changes)).toContainEqual(
        expect.objectContaining({ field: 'careLog.contactResult' }),
      );

      const resend = await call('PATCH', url, 'staffA', {
        contactResultCode: noAnswer.code,
        content: 'Nội dung mới',
      });
      expect([resend.status, resend.body.data.contactResult]).toEqual([
        200,
        noAnswer,
      ]);
      expect(await pair()).toEqual([noAnswer.id, noAnswer.code]);

      const bad = await call('PATCH', url, 'staffA', {
        contactResultCode: 'KHONG_TON_TAI',
      });
      expect([bad.status, bad.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      const mismatch = await call('PATCH', url, 'staffA', {
        contactResultId: price.id,
        contactResultCode: noAnswer.code,
      });
      expect([mismatch.status, mismatch.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(await pair()).toEqual([noAnswer.id, noAnswer.code]);

      const cleared = await call('PATCH', url, 'staffA', {
        contactResultCode: null,
      });
      expect([cleared.status, cleared.body.data.contactResult]).toEqual([
        200,
        null,
      ]);
      const doc = await storedLog(logId);
      expect([doc!.contactResultId, doc!.contactResultCode]).toEqual([
        null,
        null,
      ]);
    });
  });
});
