/**
 * INTEGRATION (QA bổ sung, M5): nhân viên bị gỡ, đổi người thực hiện, đầu vào xấu, đồng thời, thông báo.
 * Cùng harness với crm-m5.integration.spec.ts. it.failing = lỗi đã xác nhận ở review QA.
 */

import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { Queue } from 'bullmq';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  addDaysToDateKey,
  formatVnDateTime,
  startOfDayUtc,
  vnDateKey,
} from '../../common/utils/timezone.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../shared/queue/queue-runtime.service';
import {
  buildBullPrefix,
  buildRedisOptions,
} from '../../shared/redis/redis.config';
import {
  FILE_STORAGE,
  IFileStorage,
} from '../../shared/storage/file-storage.interface';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CrmSchedulerService } from './reminders/crm-scheduler.service';
import { ReminderDispatchService } from './reminders/reminder-dispatch.service';
import { ReminderScannerService } from './reminders/reminder-scanner.service';
import { CrmSeedService } from './seed/crm-seed.service';
import { PersonaSeedService } from './persona/persona-seed.service';

jest.setTimeout(300_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

interface Res {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

/** Kho ảnh giả: M5 không ghi file. */
const unusedStorage = {
  isConfigured: () => false,
  checkHealth: () => Promise.resolve(),
} as unknown as IFileStorage;

describe('CRM M5 — QA đối kháng', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let dispatch: ReminderDispatchService;
  let scanner: ReminderScannerService;
  let scheduler: CrmSchedulerService;

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
  /** SĐT VN hợp lệ, duy nhất theo thứ tự gọi (đầu 094 để không đụng M2–M4). */
  const nextPhone = () => `094${String(1_000_000 + ++phoneSeq)}`;

  const createCustomer = async (
    as: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const phone = nextPhone();
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách M5-${phoneSeq}`,
      phone,
      ...extra,
    });
    expect([res.status, res.body]).toEqual([201, expect.anything()]);
    return res.body.data.id;
  };

  const addMember = async (customerId: string, userKey: string) => {
    const res = await call(
      'POST',
      `/crm/customers/${customerId}/care-team/members`,
      'admin',
      { userIds: [ids[userKey]] },
    );
    expect(res.status).toBe(201);
  };

  const col = (name: string) => connection.collection(name);
  const oid = (id: string) => new Types.ObjectId(id);
  const customerDoc = (id: string) =>
    col('customers').findOne({ _id: oid(id) });
  const auditOf = (customerId: string, action: string) =>
    col('crm_audit_logs')
      .find({ customerId: oid(customerId), action })
      .sort({ _id: 1 })
      .toArray();
  const remindersOf = (appointmentId: string) =>
    col('reminders')
      .find({ type: 'APPOINTMENT', refId: oid(appointmentId) })
      .sort({ fireAt: 1 })
      .toArray();
  const notificationsOf = (
    userKey: string,
    filter: Record<string, unknown> = {},
  ) =>
    col('notifications')
      .find({ userId: oid(ids[userKey]), ...filter })
      .sort({ _id: 1 })
      .toArray();

  /** Giờ hẹn cách bây giờ `days` ngày (ISO UTC). */
  const inDays = (days: number, extraMs = 0): string =>
    new Date(Date.now() + days * DAY_MS + extraMs).toISOString();

  const createAppointment = async (
    as: string,
    customerId: string,
    extra: Record<string, unknown> = {},
  ): Promise<Res> =>
    call('POST', '/crm/appointments', as, {
      customerId,
      type: 'SITE_VISIT',
      startAt: inDays(3),
      ...extra,
    });

  /** Tạo lịch qua API và bắt buộc thành công, trả dữ liệu lịch. */
  const mustCreate = async (
    as: string,
    customerId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await createAppointment(as, customerId, extra);
    expect([res.status, res.body.message]).toEqual([201, undefined]);
    return res.body.data;
  };

  /** Chèn lịch trực tiếp vào DB (API không cho hẹn quá khứ) để dựng nhóm Quá hạn/Hôm nay. */
  const insertAppointment = async (
    customerId: string,
    assigneeKey: string,
    startAt: Date,
    extra: Record<string, unknown> = {},
  ) => {
    const now = new Date();
    const result = await col('appointments').insertOne({
      customerId: oid(customerId),
      type: 'MEETING',
      title: 'Lịch dựng sẵn',
      startAt,
      endAt: null,
      location: '',
      note: '',
      assigneeId: oid(ids[assigneeKey]),
      remindBeforeMinutes: [],
      status: 'SCHEDULED',
      completedAt: null,
      outcome: null,
      sourceCareLogId: null,
      createdBy: oid(ids[assigneeKey]),
      deletedAt: null,
      __v: 0,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    return String(result.insertedId);
  };

  /**
   * Hủy mọi nhắc chưa gửi của các test trước: nhắc được kích bằng "bây giờ" giả lập (có thể là vài ngày sau) nên nhắc cũ
   * cũng đến hạn và làm lệch phép đếm nhận/gửi của test hiện tại.
   */
  const resetPendingReminders = () =>
    col('reminders').updateMany(
      { status: { $in: ['PENDING', 'PROCESSING'] } },
      { $set: { status: 'CANCELED', finishedAt: new Date() } },
    );

  const todayKey = () => vnDateKey(new Date());
  /** 12:00 giờ VN của ngày `offset` so với hôm nay (an toàn quanh nửa đêm, không phụ thuộc giờ chạy test). */
  const noonVn = (offsetDays: number): Date =>
    new Date(
      startOfDayUtc(addDaysToDateKey(todayKey(), offsetDays)).getTime() +
        12 * 60 * MINUTE_MS,
    );

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-m5-${RUN_ID}:`;
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
    dispatch = app.get(ReminderDispatchService);
    scanner = app.get(ReminderScannerService);
    scheduler = app.get(CrmSchedulerService);

    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();
    await app.get(PersonaSeedService).seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('admin2', UserRole.ADMIN);
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
  describe('QA bổ sung M5', () => {
    it('nhân viên bị gỡ khỏi nhóm chăm sóc: lịch hẹn của khách đó 404 ở MỌI thao tác, không nhận nhắc, không thấy trong việc hôm nay', async () => {
      await resetPendingReminders();
      const c = await createCustomer('staffA');
      await addMember(c, 'staffB');
      const startAt = new Date(Date.now() + 3 * DAY_MS);
      const appt = await mustCreate('staffA', c, {
        startAt: startAt.toISOString(),
        assigneeId: ids.staffB,
      });
      const del = await call(
        'DELETE',
        `/crm/customers/${c}/care-team/members/${ids.staffB}`,
        'admin',
      );
      expect(del.status).toBe(200);
      for (const [method, url, body] of [
        ['GET', `/crm/appointments/${appt.id}`, undefined],
        ['PATCH', `/crm/appointments/${appt.id}`, { title: 'x', version: 0 }],
        ['PATCH', `/crm/appointments/${appt.id}/status`, { status: 'DONE' }],
        ['DELETE', `/crm/appointments/${appt.id}`, undefined],
      ] as const) {
        const res = await call(method, url, 'staffB', body);
        expect([method, url, res.status]).toEqual([method, url, 404]);
      }
      const list = await call(
        'GET',
        `/crm/appointments?from=${todayKey()}&to=${addDaysToDateKey(todayKey(), 10)}`,
        'staffB',
      );
      expect(list.body.data.map((a: any) => a.id)).not.toContain(appt.id);
      // đến giờ nhắc: staffB (đã gỡ) không nhận, staffA (phụ trách chính) vẫn nhận
      await dispatch.dispatchDue(
        new Date(startAt.getTime() - 1439 * MINUTE_MS),
      );
      expect(
        await notificationsOf('staffB', { type: 'APPOINTMENT_DUE' }),
      ).toHaveLength(0);
      expect(
        await notificationsOf('staffA', {
          type: 'APPOINTMENT_DUE',
          'data.appointmentId': oid(appt.id),
        }),
      ).toHaveLength(1);
    });

    it('đổi người thực hiện trước giờ nhắc: nhắc chỉ tới người MỚI (và phụ trách chính), không tới người cũ', async () => {
      await resetPendingReminders();
      const c = await createCustomer('staffA');
      await addMember(c, 'staffB');
      const startAt = new Date(Date.now() + 4 * DAY_MS);
      const appt = await mustCreate('staffA', c, {
        startAt: startAt.toISOString(),
        assigneeId: ids.staffB,
        remindBeforeMinutes: [60],
      });
      await addMember(c, 'manager1');
      const patch = await call(
        'PATCH',
        `/crm/appointments/${appt.id}`,
        'admin',
        { assigneeId: ids.manager1, version: appt.version },
      );
      expect(patch.status).toBe(200);
      await dispatch.dispatchDue(new Date(startAt.getTime() - 59 * MINUTE_MS));
      const forAppt = {
        type: 'APPOINTMENT_DUE',
        'data.appointmentId': oid(appt.id),
      };
      expect(await notificationsOf('staffB', forAppt)).toHaveLength(0);
      expect(await notificationsOf('manager1', forAppt)).toHaveLength(1);
      expect(await notificationsOf('staffA', forAppt)).toHaveLength(1);
    });

    it('đầu vào xấu trả 400, không bao giờ 500 và không để lại lịch/nhắc', async () => {
      const c = await createCustomer('staffA');
      const before = await col('appointments').countDocuments({
        customerId: oid(c),
      });
      const bad: Array<Record<string, unknown>> = [
        { title: 'x'.repeat(10_000) },
        { note: 'x'.repeat(100_000) },
        { location: 'x'.repeat(10_000) },
        { startAt: '2026-02-30T10:00:00Z' },
        { startAt: 'ngày mai' },
        { startAt: 12345 },
        { type: 'KHAC' },
        { remindBeforeMinutes: [-5] },
        { remindBeforeMinutes: [99_999_999] },
        { remindBeforeMinutes: Array.from({ length: 60 }, (_, i) => i + 1) },
        { remindBeforeMinutes: 'abc' },
        { assigneeId: 'zz' },
        { customerId: 'zz' },
        { unknownField: 1 },
        { endAt: inDays(3, -60_000) },
        { endAt: inDays(5) },
      ];
      for (const extra of bad) {
        const res = await createAppointment('staffA', c, extra);
        expect([JSON.stringify(extra).slice(0, 60), res.status]).toEqual([
          JSON.stringify(extra).slice(0, 60),
          400,
        ]);
      }
      expect(
        await col('appointments').countDocuments({ customerId: oid(c) }),
      ).toBe(before);
    });

    it('20 PATCH đồng thời cùng version: đúng 1 thành công, 19 VERSION_CONFLICT, nhắc khớp giờ cuối', async () => {
      await resetPendingReminders();
      const c = await createCustomer('staffA');
      const appt = await mustCreate('staffA', c, {
        startAt: inDays(5),
        remindBeforeMinutes: [60],
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          call('PATCH', `/crm/appointments/${appt.id}`, 'staffA', {
            version: appt.version,
            startAt: inDays(6, i * 3_600_000),
          }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.filter(
          (r) => r.status === 409 && r.body.errorCode === 'VERSION_CONFLICT',
        ),
      ).toHaveLength(19);
      const doc = await col('appointments').findOne({ _id: oid(appt.id) });
      const pending = (await remindersOf(appt.id)).filter(
        (r) => r.status === 'PENDING',
      );
      expect(pending).toHaveLength(1);
      expect(pending[0].dueAt.getTime()).toBe(doc!.startAt.getTime());
    });

    it('hoàn thành đồng thời nhiều lần kèm createCareLog: đúng 1 nhật ký được tạo; xóa đua với hoàn thành luôn để lại nhắc đã hủy', async () => {
      await resetPendingReminders();
      const c = await createCustomer('staffA');
      const appt = await mustCreate('staffA', c, {
        startAt: inDays(2),
        remindBeforeMinutes: [60],
      });
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          call('PATCH', `/crm/appointments/${appt.id}/status`, 'staffA', {
            status: 'DONE',
            outcome: 'Đã xem nhà',
            createCareLog: true,
          }),
        ),
      );
      expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(
        await col('care_logs').countDocuments({
          customerId: oid(c),
          deletedAt: null,
        }),
      ).toBe(1);

      const c2 = await createCustomer('staffA');
      const a2 = await mustCreate('staffA', c2, {
        startAt: inDays(2),
        remindBeforeMinutes: [60],
      });
      const race = await Promise.all([
        call('PATCH', `/crm/appointments/${a2.id}/status`, 'staffA', {
          status: 'DONE',
        }),
        call('DELETE', `/crm/appointments/${a2.id}`, 'staffA'),
      ]);
      expect(race.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(
        (await remindersOf(a2.id)).filter((r) =>
          ['PENDING', 'PROCESSING'].includes(r.status),
        ),
      ).toHaveLength(0);
      expect((await customerDoc(c2))!.nextAppointmentAt ?? null).toBeNull();
    });

    it('lịch hẹn cách giờ hiện tại ngắn hơn mọi mốc nhắc: có đúng MỘT nhắc ngay cho mốc nhỏ nhất (N1)', async () => {
      const c = await createCustomer('staffA');
      const appt = await mustCreate('staffA', c, {
        startAt: inDays(0, 30 * MINUTE_MS),
        remindBeforeMinutes: [60, 1440],
      });
      expect(await remindersOf(appt.id)).toHaveLength(1);
    });

    it('nhắc "ngay" (N1): sửa nhiều lần không sinh thêm; gửi đúng một lần; sửa sau khi gửi không gửi lại; hủy trước khi gửi thì không gửi; người bị gỡ không nhận', async () => {
      await resetPendingReminders();
      const c = await createCustomer('staffA');
      await addMember(c, 'staffB');
      const appt = await mustCreate('staffA', c, { startAt: inDays(0, 30 * MINUTE_MS), remindBeforeMinutes: [60, 1440], assigneeId: ids.staffB });
      let version = appt.version;
      for (let i = 0; i < 4; i += 1) {
        const res = await call('PATCH', `/crm/appointments/${appt.id}`, 'staffA', { version, title: `Sửa ${i}`, note: `ghi chú ${i}` });
        expect(res.status).toBe(200);
        version = res.body.data.version;
      }
      expect(await remindersOf(appt.id)).toHaveLength(1);
      await call('DELETE', `/crm/customers/${c}/care-team/members/${ids.staffB}`, 'admin');
      const forAppt = { type: 'APPOINTMENT_DUE', 'data.appointmentId': oid(appt.id) };
      const first = await dispatch.dispatchDue(new Date());
      expect(first.sent).toBeGreaterThanOrEqual(1);
      expect(await notificationsOf('staffB', forAppt)).toHaveLength(0);
      expect(await notificationsOf('staffA', forAppt)).toHaveLength(1);
      // sửa sau khi đã gửi + chạy lại: không gửi lần hai
      const after = await call('PATCH', `/crm/appointments/${appt.id}`, 'staffA', { version, title: 'Sửa sau gửi' });
      expect(after.status).toBe(200);
      await dispatch.dispatchDue(new Date());
      await dispatch.dispatchDue(new Date(Date.now() + 5 * MINUTE_MS));
      expect(await notificationsOf('staffA', forAppt)).toHaveLength(1);
      expect((await remindersOf(appt.id)).map((r) => r.status)).toEqual(['SENT']);

      // hủy trước khi gửi: không có nhắc nào được gửi
      const c2 = await createCustomer('staffA');
      const a2 = await mustCreate('staffA', c2, { startAt: inDays(0, 20 * MINUTE_MS), remindBeforeMinutes: [60] });
      expect((await call('PATCH', `/crm/appointments/${a2.id}/status`, 'staffA', { status: 'CANCELED' })).status).toBe(200);
      await dispatch.dispatchDue(new Date());
      expect(await notificationsOf('staffA', { type: 'APPOINTMENT_DUE', 'data.appointmentId': oid(a2.id) })).toHaveLength(0);
      // mở lại: dựng lại nhắc "ngay" đúng một cái
      expect((await call('PATCH', `/crm/appointments/${a2.id}/status`, 'staffA', { status: 'SCHEDULED' })).status).toBe(200);
      expect(await remindersOf(a2.id)).toHaveLength(1);
    });

    it('biên: startAt sắp tới 2 giây có nhắc ngay; startAt quá khứ (trong dung sai 5 phút) không có nhắc', async () => {
      const c = await createCustomer('staffA');
      const soon = await mustCreate('staffA', c, { startAt: new Date(Date.now() + 2000).toISOString(), remindBeforeMinutes: [60] });
      expect(await remindersOf(soon.id)).toHaveLength(1);
      const past = await mustCreate('staffA', c, { startAt: new Date(Date.now() - 60_000).toISOString(), remindBeforeMinutes: [60] });
      expect(await remindersOf(past.id)).toHaveLength(0);
    });

    it('thông báo: before sai định dạng / ids không phải ObjectId => 400; PATCH /notifications/:id sai id 400', async () => {
      expect(
        (await call('PATCH', '/notifications', 'staffA', { before: 'hôm qua' }))
          .status,
      ).toBe(400);
      expect(
        (await call('PATCH', '/notifications', 'staffA', { ids: ['zz'] }))
          .status,
      ).toBe(400);
      expect(
        (await call('PATCH', '/notifications/zz', 'staffA', { isRead: true }))
          .status,
      ).toBe(400);
      expect(
        (
          await call(
            'PATCH',
            `/notifications/${new Types.ObjectId().toHexString()}`,
            'staffA',
            { isRead: true },
          )
        ).status,
      ).toBe(404);
    });
  });
});
