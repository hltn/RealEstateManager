/**
 * INTEGRATION — CRM M5 (lịch hẹn, việc hôm nay, nhắc việc BullMQ, hộp thông báo) qua HTTP thật: Fastify + ValidationPipe
 * + GlobalExceptionFilter + JwtAuthGuard/RolesGuard + CrmFeatureGuard trên MongoDB Replica Set thật
 * (mongodb-memory-server) và Redis THẬT (idempotency, rate limit, dấu quét theo ngày, hàng đợi BullMQ;
 * `docker compose -f docker-compose.dev.yml up -d --wait`, key có tiền tố riêng mỗi lần chạy).
 * Worker/scheduler BullMQ của app TẮT trong test (`NODE_ENV=test`): nhắc việc được kích bằng cách gọi thẳng
 * `ReminderDispatchService`/`CrmSchedulerService` với "bây giờ" giả lập (xác định, không phụ thuộc đồng hồ);
 * hạ tầng queue thật được kiểm riêng ở mục "Hạ tầng BullMQ".
 *
 * Các `it` trong cùng file chạy THEO THỨ TỰ và dùng chung dữ liệu dựng ở `beforeAll`/các bước trước.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
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

describe('CRM M5 — lịch hẹn, việc hôm nay, nhắc việc, thông báo', () => {
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
  describe('Lịch hẹn: tạo, phạm vi và ma trận quyền', () => {
    let cA: string; // staffA phụ trách chính, staffB thành viên, nhóm A
    let cB: string; // staffC phụ trách chính, nhóm B
    let apptA: string;

    beforeAll(async () => {
      cA = await createCustomer('staffA');
      await addMember(cA, 'staffB');
      cB = await createCustomer('staffC');
    });

    it('tạo lịch: mặc định người thực hiện là mình, tạo nhắc theo cài đặt mặc định, cập nhật nextAppointmentAt, ghi audit cùng transaction', async () => {
      const startAt = inDays(3);
      const res = await createAppointment('staffA', cA, {
        startAt,
        title: 'Dẫn xem căn A12',
        location: 'Nhà mẫu Q',
      });
      expect(res.status).toBe(201);
      const data = res.body.data;
      apptA = data.id;
      expect(data).toMatchObject({
        type: 'SITE_VISIT',
        title: 'Dẫn xem căn A12',
        location: 'Nhà mẫu Q',
        status: 'SCHEDULED',
        assignee: { id: ids.staffA, displayName: 'staffA' },
        createdBy: { id: ids.staffA },
        remindBeforeMinutes: [1440, 60],
        startAt: new Date(startAt).toISOString(),
        endAt: null,
        completedAt: null,
        version: 0,
        canDelete: true,
        customer: { id: cA },
      });
      expect(data.customer.status.label).toEqual(expect.any(String));

      const reminders = await remindersOf(apptA);
      expect(reminders.map((r) => r.fireAt.toISOString())).toEqual([
        new Date(new Date(startAt).getTime() - 1440 * MINUTE_MS).toISOString(),
        new Date(new Date(startAt).getTime() - 60 * MINUTE_MS).toISOString(),
      ]);
      expect(reminders.every((r) => r.status === 'PENDING')).toBe(true);
      expect((await customerDoc(cA))!.nextAppointmentAt).toEqual(
        new Date(startAt),
      );
      const audit = await auditOf(cA, 'APPOINTMENT_CREATED');
      expect(audit).toHaveLength(1);
      expect(audit[0].entityType).toBe('APPOINTMENT');
      expect(String(audit[0].entityId)).toBe(apptA);
    });

    it('lưu giờ UTC từ ISO có offset +07:00; remindBeforeMinutes tùy chỉnh được chuẩn hóa, [] = không nhắc', async () => {
      const data = await mustCreate('staffA', cA, {
        startAt: `${addDaysToDateKey(todayKey(), 5)}T09:00:00+07:00`,
        remindBeforeMinutes: [15, 120],
      });
      expect(data.startAt).toBe(
        `${addDaysToDateKey(todayKey(), 5)}T02:00:00.000Z`,
      );
      expect(data.remindBeforeMinutes).toEqual([120, 15]); // sắp giảm dần
      const dup = await createAppointment('staffA', cA, {
        remindBeforeMinutes: [15, 15],
      });
      expect(dup.status).toBe(400);
      const none = await mustCreate('staffA', cA, { remindBeforeMinutes: [] });
      expect(await remindersOf(none.id)).toHaveLength(0);
    });

    it('ma trận tạo lịch theo phạm vi khách: NV/Quản lý ngoài phạm vi 404 CUSTOMER_NOT_FOUND; Quản lý trong phạm vi và Quản trị được; EDITOR 403', async () => {
      const denied: Array<[string, string]> = [
        ['staffB', cB], // cùng nhóm A nhưng không thuộc nhóm chăm sóc của khách nhóm B
        ['staffD', cA], // không nhóm, không trong nhóm chăm sóc
        ['manager2', cA], // Quản lý nhóm khác
        ['staffA', cB],
      ];
      for (const [who, customerId] of denied) {
        const res = await createAppointment(who, customerId);
        expect([who, res.status, res.body.errorCode]).toEqual([
          who,
          404,
          'CUSTOMER_NOT_FOUND',
        ]);
      }
      expect((await createAppointment('editor', cA)).status).toBe(403);
      expect((await createAppointment(null as never, cA)).status).toBe(401);

      // Quản lý nhóm A không nằm trong nhóm chăm sóc => mặc định người thực hiện là phụ trách chính.
      const byManager = await mustCreate('manager1', cA);
      expect(byManager.assignee.id).toBe(ids.staffA);
      expect(byManager.createdBy.id).toBe(ids.manager1);
      const byAdmin = await mustCreate('admin', cB);
      expect(byAdmin.assignee.id).toBe(ids.staffC);
      // Thành viên (không phải phụ trách chính) cũng tạo được, và mặc định chính họ là người thực hiện.
      const byMember = await mustCreate('staffB', cA);
      expect(byMember.assignee.id).toBe(ids.staffB);
    });

    it('người thực hiện phải thuộc nhóm chăm sóc và đang ACTIVE (400 USER_NOT_ASSIGNABLE)', async () => {
      const outsider = await createAppointment('staffA', cA, {
        assigneeId: ids.staffC,
      });
      expect([outsider.status, outsider.body.errorCode]).toEqual([
        400,
        'USER_NOT_ASSIGNABLE',
      ]);
      await userModel.updateOne(
        { _id: ids.staffB },
        { $set: { status: UserStatus.BLOCKED } },
      );
      try {
        const blocked = await createAppointment('staffA', cA, {
          assigneeId: ids.staffB,
        });
        expect([blocked.status, blocked.body.errorCode]).toEqual([
          400,
          'USER_NOT_ASSIGNABLE',
        ]);
      } finally {
        await userModel.updateOne(
          { _id: ids.staffB },
          { $set: { status: UserStatus.ACTIVE } },
        );
      }
    });

    it('quy tắc thời gian: không hẹn quá khứ (dung sai 5 phút), endAt sau startAt và ≤ 24 giờ, mốc nhắc hợp lệ; lỗi không để lại gì', async () => {
      const before = await col('appointments').countDocuments({});
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ startAt: inDays(0, -10 * MINUTE_MS) }, 'startAt'],
        [{ startAt: inDays(3), endAt: inDays(3, -MINUTE_MS) }, 'endAt'],
        [{ startAt: inDays(3), endAt: inDays(5) }, 'endAt'],
      ];
      for (const [extra, field] of cases) {
        const res = await createAppointment('staffA', cA, extra);
        expect([
          res.status,
          res.body.errorCode,
          res.body.details?.field,
        ]).toEqual([400, 'VALIDATION_FAILED', field]);
      }
      // Lệch đồng hồ nhỏ (3 phút trước) vẫn được chấp nhận.
      expect(
        (
          await createAppointment('staffA', cA, {
            startAt: inDays(0, -3 * MINUTE_MS),
          })
        ).status,
      ).toBe(201);
      for (const bad of [
        { remindBeforeMinutes: [-5] },
        { remindBeforeMinutes: [1, 2, 3, 4, 5, 6] },
        { remindBeforeMinutes: [100000] },
        { type: 'KHAC' },
      ]) {
        expect((await createAppointment('staffA', cA, bad)).status).toBe(400);
      }
      // 1 lịch hợp lệ ở bước trước, các lịch lỗi không sinh bản ghi nào.
      expect(await col('appointments').countDocuments({})).toBe(before + 1);
    });

    it('X-Idempotency-Key: gửi lại cùng khóa trả cùng lịch và chỉ tạo một bản ghi', async () => {
      const key = randomUUID();
      const startAt = inDays(4);
      const first = await call(
        'POST',
        '/crm/appointments',
        'staffA',
        { customerId: cA, type: 'CALLBACK', startAt },
        { 'x-idempotency-key': key },
      );
      const second = await call(
        'POST',
        '/crm/appointments',
        'staffA',
        { customerId: cA, type: 'CALLBACK', startAt },
        { 'x-idempotency-key': key },
      );
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(
        await col('appointments').countDocuments({
          customerId: oid(cA),
          type: 'CALLBACK',
        }),
      ).toBe(1);
    });

    it('xem lịch: chi tiết/danh sách theo phạm vi — NV trong nhóm chăm sóc, Quản lý nhóm, Quản trị thấy; người ngoài 404 RESOURCE_NOT_FOUND (không phân biệt "không tồn tại")', async () => {
      for (const who of ['staffA', 'staffB', 'manager1', 'admin']) {
        const res = await call('GET', `/crm/appointments/${apptA}`, who);
        expect([who, res.status, res.body.data?.id]).toEqual([who, 200, apptA]);
      }
      const missing = await call(
        'GET',
        `/crm/appointments/${String(new Types.ObjectId())}`,
        'admin',
      );
      for (const who of ['staffD', 'staffC', 'manager2']) {
        const res = await call('GET', `/crm/appointments/${apptA}`, who);
        expect([who, res.status, res.body.errorCode]).toEqual([
          who,
          404,
          'RESOURCE_NOT_FOUND',
        ]);
        expect(res.body.errorCode).toBe(missing.body.errorCode);
        expect(res.body.message).toBe(missing.body.message);
      }
      const range = `from=${todayKey()}&to=${addDaysToDateKey(todayKey(), 30)}&limit=100`;
      const listed = async (who: string) =>
        (await call('GET', `/crm/appointments?${range}`, who)).body.data.map(
          (item: any) => item.customer.id,
        );
      expect(new Set(await listed('staffA'))).toEqual(new Set([cA]));
      expect(new Set(await listed('manager1'))).toEqual(new Set([cA]));
      expect(new Set(await listed('staffC'))).toEqual(new Set([cB]));
      expect(new Set(await listed('admin'))).toEqual(new Set([cA, cB]));
      expect(await listed('staffD')).toEqual([]);
      expect(new Set(await listed('manager2'))).toEqual(new Set([cB]));
      expect(
        (await call('GET', `/crm/appointments?${range}`, 'editor')).status,
      ).toBe(403);
    });

    it('khoảng xem lịch: bắt buộc from/to, tối đa 62 ngày; ngày YYYY-MM-DD là ngày giờ VN (23:30 VN thuộc ngày đó, 00:30 VN thuộc ngày sau); lọc customerId/assigneeIds/types/status; sắp theo startAt', async () => {
      const day = addDaysToDateKey(todayKey(), 20);
      const next = addDaysToDateKey(day, 1);
      const late = await mustCreate('staffA', cA, {
        startAt: `${day}T23:30:00+07:00`,
        type: 'MEETING',
      });
      const early = await mustCreate('staffB', cA, {
        startAt: `${next}T00:30:00+07:00`,
        type: 'DEPOSIT_CONTRACT',
        assigneeId: ids.staffB,
      });
      const only = async (query: string) =>
        (
          await call('GET', `/crm/appointments?${query}`, 'admin')
        ).body.data.map((item: any) => item.id);
      expect(await only(`from=${day}&to=${day}`)).toEqual([late.id]);
      expect(await only(`from=${next}&to=${next}`)).toEqual([early.id]);
      expect(await only(`from=${day}&to=${next}`)).toEqual([late.id, early.id]);
      expect(await only(`from=${day}&to=${next}&sort=-startAt`)).toEqual([
        early.id,
        late.id,
      ]);
      expect(
        await only(`from=${day}&to=${next}&assigneeIds=${ids.staffB}`),
      ).toEqual([early.id]);
      expect(
        await only(`from=${day}&to=${next}&types=MEETING,SITE_VISIT`),
      ).toEqual([late.id]);
      expect(await only(`from=${day}&to=${next}&customerId=${cB}`)).toEqual([]);
      expect(await only(`from=${day}&to=${next}&status=DONE`)).toEqual([]);

      const paged = await call(
        'GET',
        `/crm/appointments?from=${day}&to=${next}&limit=1&page=2`,
        'admin',
      );
      expect(paged.body.meta).toEqual({
        total: 2,
        page: 2,
        limit: 1,
        totalPages: 2,
      });
      expect(paged.body.data.map((item: any) => item.id)).toEqual([early.id]);

      for (const bad of [
        `to=${next}`,
        `from=${day}`,
        `from=${next}&to=${day}`,
        `from=${day}&to=${addDaysToDateKey(day, 63)}`,
        `from=${day}&to=${next}&sort=title`,
        `from=${day}&to=${next}&limit=101`,
      ]) {
        expect([
          bad,
          (await call('GET', `/crm/appointments?${bad}`, 'admin')).status,
        ]).toEqual([bad, 400]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Sửa, dời lịch, đổi trạng thái, xóa mềm', () => {
    let c: string;
    let apptId: string;
    let startAt: string;

    beforeAll(async () => {
      c = await createCustomer('staffA');
      await addMember(c, 'staffB');
    });

    it('dời lịch: nhắc cũ bị hủy, nhắc mới theo giờ mới, nextAppointmentAt đổi, version tăng; không đổi gì thì không tăng version', async () => {
      startAt = inDays(6);
      const created = await mustCreate('staffA', c, { startAt });
      apptId = created.id;
      const oldReminders = await remindersOf(apptId);
      expect(oldReminders).toHaveLength(2);

      const newStart = inDays(8);
      const moved = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffB',
        {
          startAt: newStart,
          version: created.version,
        },
      );
      expect([moved.status, moved.body.message]).toEqual([200, undefined]);
      expect(moved.body.data.startAt).toBe(newStart);
      expect(moved.body.data.version).toBe(1);

      const after = await remindersOf(apptId);
      expect(after.filter((r) => r.status === 'CANCELED')).toHaveLength(2);
      const pending = after.filter((r) => r.status === 'PENDING');
      expect(pending.map((r) => r.fireAt.toISOString()).sort()).toEqual(
        [
          new Date(new Date(newStart).getTime() - 1440 * MINUTE_MS),
          new Date(new Date(newStart).getTime() - 60 * MINUTE_MS),
        ]
          .map((d) => d.toISOString())
          .sort(),
      );
      expect((await customerDoc(c))!.nextAppointmentAt).toEqual(
        new Date(newStart),
      );

      const same = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        {
          title: '',
          note: '',
          location: '',
        },
      );
      expect(same.status).toBe(200);
      expect(same.body.data.version).toBe(1);
      expect(await auditOf(c, 'APPOINTMENT_UPDATED')).toHaveLength(1);
      startAt = newStart;
    });

    it('VERSION_CONFLICT khi gửi version cũ; hai người sửa đồng thời không mất cập nhật và nhắc việc luôn khớp giờ cuối cùng', async () => {
      const stale = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        {
          note: 'ghi chú muộn',
          version: 0,
        },
      );
      expect([stale.status, stale.body.errorCode]).toEqual([
        409,
        'VERSION_CONFLICT',
      ]);
      expect(stale.body.details.currentVersion).toBe(1);

      const t1 = inDays(9);
      const t2 = inDays(10);
      const [first, second] = await Promise.all([
        call('PATCH', `/crm/appointments/${apptId}`, 'staffA', { startAt: t1 }),
        call('PATCH', `/crm/appointments/${apptId}`, 'staffB', { startAt: t2 }),
      ]);
      // Không gửi version nên cả hai đều thành công (ghi tuần tự); trạng thái cuối khớp với một trong hai.
      expect([first.status, second.status]).toEqual([200, 200]);
      const final = (await call('GET', `/crm/appointments/${apptId}`, 'admin'))
        .body.data;
      expect([t1, t2]).toContain(final.startAt);
      const pending = (await remindersOf(apptId)).filter(
        (r) => r.status === 'PENDING',
      );
      expect(pending).toHaveLength(2);
      expect(
        pending.every((r) => r.dueAt.toISOString() === final.startAt),
      ).toBe(true);
      expect((await customerDoc(c))!.nextAppointmentAt!.toISOString()).toBe(
        final.startAt,
      );
      startAt = final.startAt;
    });

    it('chỉ sửa được lịch đang chờ; dời giờ phải ở tương lai; đổi người thực hiện phải thuộc nhóm chăm sóc', async () => {
      const past = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        {
          startAt: inDays(0, -30 * MINUTE_MS),
        },
      );
      expect([past.status, past.body.details?.field]).toEqual([400, 'startAt']);
      const endOnly = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        {
          endAt: new Date(
            new Date(startAt).getTime() - MINUTE_MS,
          ).toISOString(),
        },
      );
      expect([endOnly.status, endOnly.body.details?.field]).toEqual([
        400,
        'endAt',
      ]);
      const stranger = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        {
          assigneeId: ids.staffC,
        },
      );
      expect(stranger.body.errorCode).toBe('USER_NOT_ASSIGNABLE');
      const reassigned = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        {
          assigneeId: ids.staffB,
          endAt: new Date(
            new Date(startAt).getTime() + 60 * MINUTE_MS,
          ).toISOString(),
        },
      );
      expect(reassigned.status).toBe(200);
      expect(reassigned.body.data.assignee.id).toBe(ids.staffB);
      // Người ngoài phạm vi không sửa được (404, không phải 403).
      for (const who of ['staffC', 'manager2', 'staffD']) {
        const res = await call('PATCH', `/crm/appointments/${apptId}`, who, {
          note: 'x',
        });
        expect([who, res.status, res.body.errorCode]).toEqual([
          who,
          404,
          'RESOURCE_NOT_FOUND',
        ]);
      }
    });

    it('hoàn thành kèm nhật ký (createCareLog): lịch DONE, nhắc bị hủy, nextAppointmentAt về null, nhật ký cùng transaction và cập nhật lastCareLogAt', async () => {
      const done = await call(
        'PATCH',
        `/crm/appointments/${apptId}/status`,
        'staffB',
        {
          status: 'DONE',
          outcome: 'Khách thích căn 2PN, hẹn quay lại',
          createCareLog: true,
        },
      );
      expect([done.status, done.body.message]).toEqual([200, undefined]);
      expect(done.body.data).toMatchObject({
        status: 'DONE',
        outcome: 'Khách thích căn 2PN, hẹn quay lại',
        version: 5,
      });
      expect(done.body.data.completedAt).toEqual(expect.any(String));
      expect(done.body.data.careLog).toMatchObject({
        content: 'Khách thích căn 2PN, hẹn quay lại',
        contactChannel: 'SITE_VISIT',
        author: { id: ids.staffB },
      });
      expect(
        (await remindersOf(apptId)).every((r) => r.status === 'CANCELED'),
      ).toBe(true);
      const doc = await customerDoc(c);
      expect(doc!.nextAppointmentAt).toBeNull();
      expect(doc!.lastCareLogAt).toEqual(
        new Date(done.body.data.careLog.occurredAt),
      );

      // Gửi lại cùng trạng thái: không lỗi, không ghi nhật ký lần hai.
      const again = await call(
        'PATCH',
        `/crm/appointments/${apptId}/status`,
        'staffB',
        {
          status: 'DONE',
          createCareLog: true,
        },
      );
      expect(again.status).toBe(200);
      expect(again.body.data.careLog).toBeUndefined();
      expect(
        await col('care_logs').countDocuments({ customerId: oid(c) }),
      ).toBe(1);
      // Lịch đã hoàn thành không sửa được; DONE -> CANCELED phải mở lại trước.
      const edit = await call(
        'PATCH',
        `/crm/appointments/${apptId}`,
        'staffA',
        { note: 'x' },
      );
      expect([edit.status, edit.body.errorCode]).toEqual([
        409,
        'APPOINTMENT_STATUS_INVALID',
      ]);
      const direct = await call(
        'PATCH',
        `/crm/appointments/${apptId}/status`,
        'staffA',
        {
          status: 'CANCELED',
        },
      );
      expect([direct.status, direct.body.errorCode]).toEqual([
        409,
        'APPOINTMENT_STATUS_INVALID',
      ]);
      const misuse = await call(
        'PATCH',
        `/crm/appointments/${apptId}/status`,
        'staffA',
        {
          status: 'SCHEDULED',
          createCareLog: true,
        },
      );
      expect([misuse.status, misuse.body.details?.field]).toEqual([
        400,
        'createCareLog',
      ]);
    });

    it('mở lại lịch còn ở tương lai dựng lại nhắc (dùng lại mốc đã hủy, không nhân đôi) và nextAppointmentAt; hủy lịch hủy nhắc', async () => {
      const totalBefore = (await remindersOf(apptId)).length;
      const reopened = await call(
        'PATCH',
        `/crm/appointments/${apptId}/status`,
        'staffA',
        {
          status: 'SCHEDULED',
        },
      );
      expect([
        reopened.status,
        reopened.body.data?.status,
        reopened.body.data?.completedAt,
      ]).toEqual([200, 'SCHEDULED', null]);
      const reminders = await remindersOf(apptId);
      // Mốc của giờ hiện tại được mở lại (không tạo bản ghi mới); các mốc của giờ cũ vẫn hủy.
      expect(reminders).toHaveLength(totalBefore);
      const pending = reminders.filter((r) => r.status === 'PENDING');
      expect(pending).toHaveLength(2);
      expect(pending.every((r) => r.dueAt.toISOString() === startAt)).toBe(
        true,
      );
      expect((await customerDoc(c))!.nextAppointmentAt!.toISOString()).toBe(
        startAt,
      );

      const canceled = await call(
        'PATCH',
        `/crm/appointments/${apptId}/status`,
        'staffA',
        {
          status: 'CANCELED',
          outcome: 'Khách báo bận',
        },
      );
      expect(canceled.body.data).toMatchObject({
        status: 'CANCELED',
        outcome: 'Khách báo bận',
        completedAt: null,
      });
      expect(
        (await remindersOf(apptId)).some((r) => r.status === 'PENDING'),
      ).toBe(false);
      expect((await customerDoc(c))!.nextAppointmentAt).toBeNull();
      const actions = (await auditOf(c, 'APPOINTMENT_STATUS_CHANGED')).map(
        (a) => a.changes[0].to,
      );
      expect(actions).toEqual(['DONE', 'SCHEDULED', 'CANCELED']);
    });

    it('xóa mềm: Quản trị/Quản lý (trong phạm vi) xóa mọi lịch; NV chỉ xóa lịch mình tạo (403 với lịch của người khác); lịch biến mất khỏi danh sách, nhắc hủy, nextAppointmentAt tính lại', async () => {
      const byA = await mustCreate('staffA', c, { startAt: inDays(11) });
      const byB = await mustCreate('staffB', c, {
        startAt: inDays(12),
        assigneeId: ids.staffB,
      });
      const forbidden = await call(
        'DELETE',
        `/crm/appointments/${byA.id}`,
        'staffB',
      );
      expect(forbidden.status).toBe(403);
      expect((await customerDoc(c))!.nextAppointmentAt!.toISOString()).toBe(
        byA.startAt,
      );

      expect(
        (await call('DELETE', `/crm/appointments/${byA.id}`, 'staffA')).status,
      ).toBe(204);
      expect((await customerDoc(c))!.nextAppointmentAt!.toISOString()).toBe(
        byB.startAt,
      );
      expect(
        (await call('GET', `/crm/appointments/${byA.id}`, 'admin')).status,
      ).toBe(404);
      expect(
        (await remindersOf(byA.id)).some((r) => r.status === 'PENDING'),
      ).toBe(false);
      const doc = await col('appointments').findOne({ _id: oid(byA.id) });
      expect(doc!.deletedAt).toEqual(expect.any(Date));
      expect(await auditOf(c, 'APPOINTMENT_DELETED')).toHaveLength(1);

      expect(
        (await call('DELETE', `/crm/appointments/${byB.id}`, 'manager1'))
          .status,
      ).toBe(204);
      expect(
        (await call('DELETE', `/crm/appointments/${byB.id}`, 'manager1'))
          .status,
      ).toBe(404);
      expect((await customerDoc(c))!.nextAppointmentAt).toBeNull();
      // Quản lý nhóm khác và người ngoài: 404.
      const other = await mustCreate('staffA', c, { startAt: inDays(13) });
      expect(
        (await call('DELETE', `/crm/appointments/${other.id}`, 'manager2'))
          .status,
      ).toBe(404);
      expect(
        (await call('DELETE', `/crm/appointments/${other.id}`, 'admin')).status,
      ).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('nextAction của nhật ký: lịch hẹn kèm theo và nhắc bước tiếp theo', () => {
    let c: string;

    beforeAll(async () => {
      c = await createCustomer('staffA');
      await addMember(c, 'staffB');
    });

    it('nextAction.appointment tạo lịch đúng giờ dueAt, liên kết hai chiều, nextAppointmentAt đổi — tất cả trong một transaction', async () => {
      const dueAt = inDays(5);
      const res = await call(
        'POST',
        `/crm/customers/${c}/care-logs`,
        'staffA',
        {
          content: 'Đã gọi, khách muốn xem nhà',
          contactChannel: 'CALL',
          nextAction: {
            suggestion: 'Dẫn khách xem nhà mẫu',
            dueAt,
            appointment: { type: 'SITE_VISIT', location: 'Nhà mẫu A' },
          },
        },
      );
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      const appointmentId = res.body.data.nextAction.appointmentId;
      expect(appointmentId).toEqual(expect.any(String));

      const appointment = (
        await call('GET', `/crm/appointments/${appointmentId}`, 'staffA')
      ).body.data;
      expect(appointment).toMatchObject({
        type: 'SITE_VISIT',
        title: 'Dẫn khách xem nhà mẫu',
        location: 'Nhà mẫu A',
        startAt: dueAt,
        assignee: { id: ids.staffA },
      });
      const doc = await col('appointments').findOne({
        _id: oid(appointmentId),
      });
      expect(String(doc!.sourceCareLogId)).toBe(res.body.data.id);
      expect((await customerDoc(c))!.nextAppointmentAt!.toISOString()).toBe(
        dueAt,
      );
      // Có lịch hẹn đi kèm thì không sinh thêm nhắc "bước tiếp theo" (lịch đã có nhắc riêng).
      expect(
        await col('reminders').countDocuments({
          type: 'FOLLOW_UP',
          customerId: oid(c),
        }),
      ).toBe(0);
    });

    it('thiếu dueAt hoặc giờ hẹn quá khứ => 400 và KHÔNG tạo nhật ký (hoàn tác trọn vẹn)', async () => {
      const logsBefore = await col('care_logs').countDocuments({
        customerId: oid(c),
      });
      const appointmentsBefore = await col('appointments').countDocuments({
        customerId: oid(c),
      });
      const noDue = await call(
        'POST',
        `/crm/customers/${c}/care-logs`,
        'staffA',
        {
          content: 'x',
          contactChannel: 'CALL',
          nextAction: { appointment: { type: 'MEETING' } },
        },
      );
      expect([noDue.status, noDue.body.details?.field]).toEqual([
        400,
        'nextAction.dueAt',
      ]);
      const past = await call(
        'POST',
        `/crm/customers/${c}/care-logs`,
        'staffA',
        {
          content: 'x',
          contactChannel: 'CALL',
          nextAction: { dueAt: inDays(-1), appointment: { type: 'MEETING' } },
        },
      );
      expect([past.status, past.body.details?.field]).toEqual([400, 'startAt']);
      expect(
        await col('care_logs').countDocuments({ customerId: oid(c) }),
      ).toBe(logsBefore);
      expect(
        await col('appointments').countDocuments({ customerId: oid(c) }),
      ).toBe(appointmentsBefore);
    });

    it('bước tiếp theo không có lịch hẹn: nhắc FOLLOW_UP đúng hạn cho người ghi + phụ trách chính; nhật ký mới hơn thì không nhắc nữa', async () => {
      await resetPendingReminders();
      const dueAt = inDays(2);
      const log = await call(
        'POST',
        `/crm/customers/${c}/care-logs`,
        'staffB',
        {
          content: 'Hẹn gọi lại',
          contactChannel: 'CALL',
          nextAction: { suggestion: 'Gọi lại chốt lịch', dueAt },
        },
      );
      expect(log.status).toBe(201);
      const reminders = await col('reminders')
        .find({ type: 'FOLLOW_UP', refId: oid(log.body.data.id) })
        .toArray();
      expect(reminders).toHaveLength(1);
      expect(reminders[0].fireAt.toISOString()).toBe(dueAt);

      const result = await dispatch.dispatchDue(
        new Date(new Date(dueAt).getTime() + MINUTE_MS),
      );
      expect(result).toMatchObject({ sent: 1 });
      const toB = await notificationsOf('staffB', { type: 'FOLLOW_UP_DUE' });
      const toA = await notificationsOf('staffA', { type: 'FOLLOW_UP_DUE' });
      expect([toB, toA].map((list) => list.length)).toEqual([1, 1]);
      expect(toA[0].priority).toBe('HIGH'); // staffA là phụ trách chính
      expect(toB[0].priority).toBe('NORMAL');
      expect(toB[0].body).toContain('Khách ');
    });

    it('nhật ký mới hơn thay thế bước tiếp theo cũ: nhắc đến hạn bị hủy, không gửi', async () => {
      await resetPendingReminders();
      const dueAt = inDays(2, 3 * MINUTE_MS);
      const old = await call(
        'POST',
        `/crm/customers/${c}/care-logs`,
        'staffA',
        {
          content: 'Hẹn gọi lại lần 2',
          contactChannel: 'CALL',
          nextAction: { suggestion: 'Gọi lần 2', dueAt },
        },
      );
      await call('POST', `/crm/customers/${c}/care-logs`, 'staffA', {
        content: 'Đã tự liên hệ trước hạn',
        contactChannel: 'ZALO',
      });
      const before = await col('notifications').countDocuments({
        type: 'FOLLOW_UP_DUE',
      });
      const result = await dispatch.dispatchDue(
        new Date(new Date(dueAt).getTime() + MINUTE_MS),
      );
      expect(result).toMatchObject({ claimed: 1, sent: 0, canceled: 1 });
      expect(
        await col('notifications').countDocuments({ type: 'FOLLOW_UP_DUE' }),
      ).toBe(before);
      const reminder = await col('reminders').findOne({
        type: 'FOLLOW_UP',
        refId: oid(old.body.data.id),
      });
      expect(reminder!.status).toBe('CANCELED');
    });

    it('xóa nhật ký hủy nhắc bước tiếp theo của nó', async () => {
      const log = await call(
        'POST',
        `/crm/customers/${c}/care-logs`,
        'staffA',
        {
          content: 'Ghi nhầm',
          contactChannel: 'CALL',
          nextAction: { dueAt: inDays(4) },
        },
      );
      expect(
        (await col('reminders').findOne({ refId: oid(log.body.data.id) }))!
          .status,
      ).toBe('PENDING');
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${c}/care-logs/${log.body.data.id}`,
            'staffA',
          )
        ).status,
      ).toBe(204);
      expect(
        (await col('reminders').findOne({ refId: oid(log.body.data.id) }))!
          .status,
      ).toBe('CANCELED');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Nhắc việc đến hạn: đúng người, đúng hạn, không trùng', () => {
    let c: string;
    let appt: any;
    let startAt: Date;

    beforeAll(async () => {
      c = await createCustomer('staffA'); // staffA phụ trách chính
      await addMember(c, 'staffB');
      await resetPendingReminders();
      startAt = new Date(Date.now() + 3 * DAY_MS);
      appt = await mustCreate('staffA', c, {
        startAt: startAt.toISOString(),
        assigneeId: ids.staffB,
        title: 'Xem nhà',
      });
    });

    const at = (offsetMinutes: number) =>
      new Date(startAt.getTime() + offsetMinutes * MINUTE_MS);

    it('chưa đến mốc thì không gửi; đến mốc "trước 1 ngày": gửi cho người thực hiện (NORMAL) và phụ trách chính (HIGH), nội dung giờ VN, không lộ SĐT', async () => {
      expect(await dispatch.dispatchDue(at(-1441))).toMatchObject({
        claimed: 0,
      });
      const result = await dispatch.dispatchDue(at(-1439));
      expect(result).toMatchObject({
        claimed: 1,
        sent: 1,
        canceled: 0,
        failed: 0,
      });

      const toB = await notificationsOf('staffB', { type: 'APPOINTMENT_DUE' });
      const toA = await notificationsOf('staffA', { type: 'APPOINTMENT_DUE' });
      expect(toB).toHaveLength(1);
      expect(toA).toHaveLength(1);
      expect(toB[0]).toMatchObject({
        title: 'Sắp đến giờ hẹn',
        priority: 'NORMAL',
        pushStatus: 'SKIPPED',
        readAt: null,
      });
      expect(toA[0].priority).toBe('HIGH');
      expect(toB[0].body).toContain(formatVnDateTime(startAt));
      expect(toB[0].body).toContain('Xem nhà mẫu');
      expect(String(toB[0].data.appointmentId)).toBe(appt.id);
      expect(String(toB[0].data.customerId)).toBe(c);
      expect(JSON.stringify(toB[0])).not.toMatch(/(\+84|0)94\d{7}/);
      // Người không thuộc nhóm chăm sóc không nhận.
      expect(
        await notificationsOf('manager1', { type: 'APPOINTMENT_DUE' }),
      ).toHaveLength(0);

      const reminders = await remindersOf(appt.id);
      expect(reminders.map((r) => r.status)).toEqual(['SENT', 'PENDING']);
      expect(reminders[0].sentAt).toEqual(expect.any(Date));
    });

    it('chạy lại cùng thời điểm (restart, retry) không nhắc lặp; ba tiến trình chạy ĐỒNG THỜI cho mốc còn lại chỉ tạo đúng một thông báo mỗi người', async () => {
      expect(await dispatch.dispatchDue(at(-1439))).toMatchObject({
        claimed: 0,
      });
      const runs = await Promise.all([
        dispatch.dispatchDue(at(-59)),
        dispatch.dispatchDue(at(-59)),
        dispatch.dispatchDue(at(-59)),
      ]);
      expect(runs.reduce((sum, run) => sum + run.sent, 0)).toBe(1);
      expect(runs.reduce((sum, run) => sum + run.claimed, 0)).toBe(1);
      expect(
        await notificationsOf('staffB', { type: 'APPOINTMENT_DUE' }),
      ).toHaveLength(2);
      expect(
        await notificationsOf('staffA', { type: 'APPOINTMENT_DUE' }),
      ).toHaveLength(2);
    });

    it('nhắc kẹt ở PROCESSING (instance chết giữa chừng) được nhận lại sau thời hạn khóa và gửi đúng một lần', async () => {
      await resetPendingReminders();
      const stuck = await createCustomer('staffA');
      const created = await mustCreate('staffA', stuck, {
        startAt: inDays(3),
        remindBeforeMinutes: [60],
      });
      const start = new Date(created.startAt);
      await col('reminders').updateOne(
        { refId: oid(created.id) },
        {
          $set: {
            status: 'PROCESSING',
            lockedAt: new Date(start.getTime() - 61 * MINUTE_MS),
          },
        },
      );
      // Còn trong thời hạn khóa (instance khác đang xử lý): chưa nhận lại.
      expect(
        await dispatch.dispatchDue(new Date(start.getTime() - 59 * MINUTE_MS)),
      ).toMatchObject({ claimed: 0 });
      // Quá hạn khóa 5 phút: nhận lại và gửi.
      const result = await dispatch.dispatchDue(
        new Date(start.getTime() - 50 * MINUTE_MS),
      );
      expect(result).toMatchObject({ claimed: 1, sent: 1 });
      expect(
        await notificationsOf('staffA', {
          'data.appointmentId': oid(created.id),
        }),
      ).toHaveLength(1);
      expect(
        (await col('reminders').findOne({ refId: oid(created.id) }))!.attempts,
      ).toBe(1);
    });

    it('dời lịch TRƯỚC khi đến hạn: nhắc theo giờ cũ không bao giờ gửi, nhắc theo giờ mới gửi đúng giờ mới', async () => {
      await resetPendingReminders();
      const c2 = await createCustomer('staffA');
      const created = await mustCreate('staffA', c2, {
        startAt: inDays(3),
        remindBeforeMinutes: [60],
      });
      const oldStart = new Date(created.startAt);
      const newStart = new Date(oldStart.getTime() + 2 * DAY_MS);
      const moved = await call(
        'PATCH',
        `/crm/appointments/${created.id}`,
        'staffA',
        { startAt: newStart.toISOString() },
      );
      expect(moved.status).toBe(200);

      const atOldReminder = await dispatch.dispatchDue(
        new Date(oldStart.getTime() - 30 * MINUTE_MS),
      );
      expect(atOldReminder.claimed).toBe(0);
      expect(
        await notificationsOf('staffA', { 'data.customerId': oid(c2) }),
      ).toHaveLength(0);
      const atNewReminder = await dispatch.dispatchDue(
        new Date(newStart.getTime() - 30 * MINUTE_MS),
      );
      expect(atNewReminder).toMatchObject({ claimed: 1, sent: 1 });
      const [notification] = await notificationsOf('staffA', {
        'data.customerId': oid(c2),
      });
      expect(notification.body).toContain(formatVnDateTime(newStart));
    });

    it('N1: lịch cách hiện tại ngắn hơn mọi mốc nhắc vẫn có MỘT nhắc ngay (mốc nhỏ nhất), gửi đúng một lần dù sync lại; lịch quá khứ thì không nhắc', async () => {
      await resetPendingReminders();
      const c2 = await createCustomer('staffA');
      const created = await mustCreate('staffA', c2, {
        startAt: new Date(Date.now() + 30 * MINUTE_MS).toISOString(),
        remindBeforeMinutes: [1440, 60],
      });
      const reminders = await remindersOf(created.id);
      expect(reminders).toHaveLength(1);
      expect(reminders[0].dedupeKey).toContain(`:60:`);
      expect(reminders[0].status).toBe('PENDING');

      const first = await dispatch.dispatchDue(new Date(Date.now() + 1000));
      expect(first).toMatchObject({ claimed: 1, sent: 1 });
      // Sửa lịch (không đổi giờ) đồng bộ lại nhắc: không sinh nhắc mới, không gửi lại.
      const edited = await call(
        'PATCH',
        `/crm/appointments/${created.id}`,
        'staffA',
        { title: 'Đổi tiêu đề' },
      );
      expect(edited.status).toBe(200);
      expect(await remindersOf(created.id)).toHaveLength(1);
      expect(
        await dispatch.dispatchDue(new Date(Date.now() + 2000)),
      ).toMatchObject({ claimed: 0 });
      expect(
        await notificationsOf('staffA', { 'data.customerId': oid(c2) }),
      ).toHaveLength(1);
    });

    it('lịch không còn SCHEDULED dù nhắc chưa kịp hủy (đua): chốt gửi đọc lại thấy trạng thái mới và hủy, không gửi nhắc cũ', async () => {
      await resetPendingReminders();
      const c3 = await createCustomer('staffA');
      const created = await mustCreate('staffA', c3, {
        startAt: inDays(3),
        remindBeforeMinutes: [60],
      });
      const start = new Date(created.startAt);
      // Mô phỏng: lịch bị hủy mà nhắc còn PENDING (nhắc chưa kịp bị hủy theo).
      const now = new Date(start.getTime() - 30 * MINUTE_MS);
      await col('appointments').updateOne(
        { _id: oid(created.id) },
        { $set: { status: 'CANCELED' } },
      );
      const result = await dispatch.dispatchDue(now);
      expect(result).toMatchObject({ claimed: 1, sent: 0, canceled: 1 });
      expect(
        await notificationsOf('staffA', { 'data.customerId': oid(c3) }),
      ).toHaveLength(0);
    });

    it('hoàn thành/hủy/xóa lịch hoặc lịch đã bắt đầu: không còn nhắc nào đến hạn', async () => {
      await resetPendingReminders();
      for (const action of ['DONE', 'CANCELED', 'DELETE'] as const) {
        const cx = await createCustomer('staffA');
        const created = await mustCreate('staffA', cx, {
          startAt: inDays(3),
          remindBeforeMinutes: [60, 15],
        });
        if (action === 'DELETE') {
          await call('DELETE', `/crm/appointments/${created.id}`, 'staffA');
        } else {
          await call(
            'PATCH',
            `/crm/appointments/${created.id}/status`,
            'staffA',
            { status: action },
          );
        }
        const when = new Date(
          new Date(created.startAt).getTime() - 10 * MINUTE_MS,
        );
        expect([action, (await dispatch.dispatchDue(when)).claimed]).toEqual([
          action,
          0,
        ]);
      }
      // Lịch đã bắt đầu (nhắc quá muộn, vd hệ thống ngừng nhiều giờ): hủy, không gửi nhắc vô nghĩa.
      const late = await createCustomer('staffA');
      const created = await mustCreate('staffA', late, {
        startAt: inDays(3),
        remindBeforeMinutes: [60],
      });
      const result = await dispatch.dispatchDue(
        new Date(new Date(created.startAt).getTime() + MINUTE_MS),
      );
      expect(result).toMatchObject({ claimed: 1, sent: 0, canceled: 1 });
    });

    it('QT8: người bị gỡ khỏi nhóm chăm sóc trước giờ nhắc không nhận; phụ trách chính vẫn nhận; hết người nhận thì hủy', async () => {
      await resetPendingReminders();
      const cx = await createCustomer('staffA');
      await addMember(cx, 'staffB');
      const created = await mustCreate('staffA', cx, {
        startAt: inDays(3),
        assigneeId: ids.staffB,
        remindBeforeMinutes: [60],
      });
      const removal = await call(
        'DELETE',
        `/crm/customers/${cx}/care-team/members/${ids.staffB}`,
        'admin',
      );
      expect(removal.status).toBe(200);
      const result = await dispatch.dispatchDue(
        new Date(new Date(created.startAt).getTime() - 30 * MINUTE_MS),
      );
      expect(result.sent).toBe(1);
      expect(
        await notificationsOf('staffB', {
          'data.appointmentId': oid(created.id),
        }),
      ).toHaveLength(0);
      expect(
        await notificationsOf('staffA', {
          'data.appointmentId': oid(created.id),
        }),
      ).toHaveLength(1);

      // Nhóm chăm sóc không còn ai (bỏ cả phụ trách chính bằng DB) => không có người nhận => hủy.
      const empty = await createCustomer('staffA');
      const second = await mustCreate('staffA', empty, {
        startAt: inDays(3),
        remindBeforeMinutes: [60],
      });
      await col('customers').updateOne(
        { _id: oid(empty) },
        { $set: { careTeam: [], primaryAssigneeId: null } },
      );
      const emptyResult = await dispatch.dispatchDue(
        new Date(new Date(second.startAt).getTime() - 30 * MINUTE_MS),
      );
      expect(emptyResult).toMatchObject({ claimed: 1, sent: 0, canceled: 1 });
    });

    it('người nhận tắt loại APPOINTMENT_DUE trong cài đặt thì không có thông báo; người khác vẫn nhận', async () => {
      await resetPendingReminders();
      const cx = await createCustomer('staffA');
      await addMember(cx, 'staffB');
      const created = await mustCreate('staffA', cx, {
        startAt: inDays(3),
        assigneeId: ids.staffB,
        remindBeforeMinutes: [60],
      });
      const put = await call('PUT', '/notification-preferences/me', 'staffB', {
        types: { APPOINTMENT_DUE: { push: false, inApp: false } },
      });
      expect(put.status).toBe(200);
      try {
        await dispatch.dispatchDue(
          new Date(new Date(created.startAt).getTime() - 30 * MINUTE_MS),
        );
      } finally {
        await call('PUT', '/notification-preferences/me', 'staffB', {
          types: { APPOINTMENT_DUE: { push: true, inApp: true } },
        });
      }
      expect(
        await notificationsOf('staffB', {
          'data.appointmentId': oid(created.id),
        }),
      ).toHaveLength(0);
      expect(
        await notificationsOf('staffA', {
          'data.appointmentId': oid(created.id),
        }),
      ).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Quét theo ngày: dịp đặc biệt và khách lâu chưa chăm sóc', () => {
    const birthdayOn = (dateKey: string) => `1990${dateKey.slice(4)}`;
    const setBirthday = async (
      customerId: string,
      who: string,
      dateKey: string,
    ) => {
      const current = (
        await call('GET', `/crm/customers/${customerId}/persona`, who)
      ).body.data.version;
      const res = await call(
        'PATCH',
        `/crm/customers/${customerId}/persona`,
        who,
        {
          version: current,
          values: [
            {
              fieldKey: 'birthday',
              value: { valueDate: birthdayOn(dateKey) },
              source: 'CUSTOMER_SHARED',
            },
          ],
        },
      );
      expect([res.status, res.body.message]).toEqual([200, undefined]);
    };

    it('dịp đặc biệt: quét tạo MỘT nhắc cho mỗi (khách, dịp, ngày, leadDays); quét lại không tạo thêm; gửi cho cả nhóm chăm sóc, phụ trách chính HIGH', async () => {
      await resetPendingReminders();
      const today = todayKey();
      const tomorrow = addDaysToDateKey(today, 1);
      const cToday = await createCustomer('staffA');
      await addMember(cToday, 'staffB');
      await setBirthday(cToday, 'staffA', today);
      const cTomorrow = await createCustomer('staffA');
      await setBirthday(cTomorrow, 'staffA', tomorrow);
      const cLater = await createCustomer('staffA');
      await setBirthday(cLater, 'staffA', addDaysToDateKey(today, 5));

      const now = new Date();
      expect(await scanner.scanOccasions(now)).toBe(2);
      expect(await scanner.scanOccasions(now)).toBe(0);
      const reminders = await col('reminders')
        .find({
          type: 'OCCASION',
          customerId: { $in: [oid(cToday), oid(cTomorrow), oid(cLater)] },
        })
        .toArray();
      expect(
        reminders
          .map((r) => `${r.payload.occurrenceDate}:${r.payload.leadDays}`)
          .sort(),
      ).toEqual([`${today}:0`, `${tomorrow}:1`].sort());

      await dispatch.dispatchDue(new Date(now.getTime() + MINUTE_MS));
      const toB = await notificationsOf('staffB', {
        type: 'CUSTOMER_OCCASION',
        'data.customerId': oid(cToday),
      });
      const toA = await notificationsOf('staffA', {
        type: 'CUSTOMER_OCCASION',
        'data.customerId': oid(cToday),
      });
      expect([toB.length, toA.length]).toEqual([1, 1]);
      expect(toA[0].priority).toBe('HIGH');
      expect(toA[0].body).toMatch(/^Hôm nay là sinh nhật/i);
      const tomorrowNote = await notificationsOf('staffA', {
        type: 'CUSTOMER_OCCASION',
        'data.customerId': oid(cTomorrow),
      });
      expect(tomorrowNote[0].body).toMatch(/^Ngày mai là sinh nhật/i);
      expect(
        await notificationsOf('staffA', {
          'data.customerId': oid(cLater),
          type: 'CUSTOMER_OCCASION',
        }),
      ).toHaveLength(0);
    });

    it('khách lâu chưa chăm sóc: một nhắc cho mỗi đợt (neo theo nhật ký mới nhất), chỉ gửi phụ trách chính; có nhật ký mới thì đợt mới', async () => {
      await resetPendingReminders();
      const cx = await createCustomer('staffA');
      await addMember(cx, 'staffB');
      const old = new Date(Date.now() - 30 * DAY_MS);
      await col('customers').updateOne(
        { _id: oid(cx) },
        { $set: { lastCareLogAt: old, createdAt: old } },
      );
      const fresh = await createCustomer('staffA'); // vừa tạo: chưa quá 14 ngày
      const now = new Date();
      await scanner.scanStale(now);
      const mine = await col('reminders')
        .find({ type: 'STALE_CUSTOMER', customerId: oid(cx) })
        .toArray();
      expect(mine).toHaveLength(1);
      expect(
        await col('reminders').countDocuments({
          type: 'STALE_CUSTOMER',
          customerId: oid(fresh),
        }),
      ).toBe(0);
      expect(await scanner.scanStale(now)).toBe(0);

      await dispatch.dispatchDue(new Date(now.getTime() + MINUTE_MS));
      const toA = await notificationsOf('staffA', {
        type: 'STALE_CUSTOMER',
        'data.customerId': oid(cx),
      });
      expect(toA).toHaveLength(1);
      expect(toA[0].priority).toBe('HIGH');
      expect(
        await notificationsOf('staffB', {
          type: 'STALE_CUSTOMER',
          'data.customerId': oid(cx),
        }),
      ).toHaveLength(0);

      // Ngày hôm sau vẫn cùng đợt: không nhắc lại; sau khi có nhật ký rồi lại lâu: đợt mới (neo mới).
      expect(await scanner.scanStale(new Date(now.getTime() + DAY_MS))).toBe(0);
      const newer = new Date(Date.now() - 20 * DAY_MS);
      await col('customers').updateOne(
        { _id: oid(cx) },
        { $set: { lastCareLogAt: newer } },
      );
      await scanner.scanStale(new Date(now.getTime() + 2 * DAY_MS));
      expect(
        await col('reminders').countDocuments({
          type: 'STALE_CUSTOMER',
          customerId: oid(cx),
        }),
      ).toBe(2);
    });

    it('lịch quét theo ngày: chỉ chạy từ giờ cấu hình (giờ VN), tối đa một lần mỗi ngày dù tick nhiều lần/nhiều instance; ngày mới quét lại; cờ CRM tắt thì bỏ qua', async () => {
      await resetPendingReminders();
      const dayKey = addDaysToDateKey(todayKey(), 40);
      const vnAt = (time: string) => new Date(`${dayKey}T${time}:00+07:00`);
      const stale = await createCustomer('staffA');
      const longAgo = new Date(vnAt('00:00').getTime() - 60 * DAY_MS);
      await col('customers').updateOne(
        { _id: oid(stale) },
        { $set: { lastCareLogAt: longAgo } },
      );
      const staleCount = () =>
        col('reminders').countDocuments({
          type: 'STALE_CUSTOMER',
          customerId: oid(stale),
        });

      await scheduler.runTick(vnAt('07:59')); // trước 08:00 (staleCheckTime mặc định)
      expect(await staleCount()).toBe(0);
      await Promise.all([
        scheduler.runTick(vnAt('08:00')),
        scheduler.runTick(vnAt('08:00')),
        scheduler.runTick(vnAt('08:01')),
      ]);
      expect(await staleCount()).toBe(1);

      // Dấu "đã quét hôm nay": khách mới đủ điều kiện sau đó KHÔNG bị quét lại cùng ngày.
      const late = await createCustomer('staffA');
      await col('customers').updateOne(
        { _id: oid(late) },
        { $set: { lastCareLogAt: longAgo } },
      );
      await scheduler.runTick(vnAt('15:00'));
      expect(
        await col('reminders').countDocuments({
          type: 'STALE_CUSTOMER',
          customerId: oid(late),
        }),
      ).toBe(0);
      // Sang ngày kế tiếp thì quét lại và bắt khách mới.
      await scheduler.runTick(new Date(vnAt('08:05').getTime() + DAY_MS));
      expect(
        await col('reminders').countDocuments({
          type: 'STALE_CUSTOMER',
          customerId: oid(late),
        }),
      ).toBe(1);

      process.env[FLAG] = 'false';
      try {
        const spy = jest.spyOn(dispatch, 'dispatchDue');
        await scheduler.handle({ name: 'reminders.tick' });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      } finally {
        process.env[FLAG] = 'true';
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Vòng đời khách: xóa mềm, khôi phục, ẩn danh hóa', () => {
    it('xóa mềm hủy nhắc chưa gửi; khôi phục dựng lại nhắc cho lịch còn ở tương lai; ẩn danh hóa dọn sạch lịch hẹn, nhắc, thông báo và audit', async () => {
      await resetPendingReminders();
      const c = await createCustomer('staffA');
      await addMember(c, 'staffB');
      const created = await mustCreate('staffA', c, {
        startAt: inDays(5),
        title: 'Gặp anh Nguyễn Văn Bí mật',
        location: 'Số 1 đường Kín',
        note: 'Khách có bệnh nền, SĐT khác 0912345678',
        remindBeforeMinutes: [1440, 60],
      });
      await call('PATCH', `/crm/appointments/${created.id}`, 'staffA', {
        note: 'Ghi chú đã sửa riêng tư',
      });
      await call('PATCH', `/crm/appointments/${created.id}/status`, 'staffA', {
        status: 'DONE',
        outcome: 'Kết quả riêng tư của khách',
      });
      await call('PATCH', `/crm/appointments/${created.id}/status`, 'staffA', {
        status: 'SCHEDULED',
      });
      await dispatch.dispatchDue(
        new Date(new Date(created.startAt).getTime() - 1430 * MINUTE_MS),
      );
      expect(
        await col('notifications').countDocuments({
          'data.customerId': oid(c),
        }),
      ).toBeGreaterThan(0);

      // Xóa mềm: mọi nhắc chưa gửi bị hủy; lịch không còn hiện với người dùng (khách đã xóa).
      expect(
        (await call('DELETE', `/crm/customers/${c}?reason=x`, 'admin')).status,
      ).toBe(204);
      expect(
        (await remindersOf(created.id)).some((r) => r.status === 'PENDING'),
      ).toBe(false);
      expect(
        (await call('GET', `/crm/appointments/${created.id}`, 'admin')).status,
      ).toBe(404);
      expect(
        (
          await call(
            'GET',
            `/crm/appointments?from=${todayKey()}&to=${addDaysToDateKey(todayKey(), 30)}&customerId=${c}`,
            'admin',
          )
        ).body.data,
      ).toEqual([]);

      // Khôi phục: nhắc cho lịch còn ở tương lai được dựng lại.
      const restored = await call(
        'POST',
        '/crm/customer-restorations',
        'admin',
        { customerId: c },
      );
      expect(restored.status).toBe(201);
      expect(
        (await call('GET', `/crm/appointments/${created.id}`, 'staffB')).status,
      ).toBe(200);
      expect(
        (await remindersOf(created.id)).filter((r) => r.status === 'PENDING'),
      ).toHaveLength(1);
      // Mốc 1440 đã gửi trước đó nên không gửi lại (khóa chống trùng giữ nguyên).
      expect(
        (await remindersOf(created.id)).filter((r) => r.status === 'SENT'),
      ).toHaveLength(1);

      const anonymized = await call(
        'POST',
        '/crm/customer-anonymizations',
        'admin',
        {
          customerId: c,
          reason: 'Khách yêu cầu xóa dữ liệu',
          confirm: true,
        },
      );
      expect([anonymized.status, anonymized.body.message]).toEqual([
        201,
        undefined,
      ]);

      const appointment = await col('appointments').findOne({
        _id: oid(created.id),
      });
      expect(JSON.stringify(appointment)).not.toMatch(
        /Bí mật|Kín|bệnh nền|riêng tư|0912345678/,
      );
      expect(appointment).toMatchObject({
        type: 'SITE_VISIT',
        status: 'SCHEDULED',
      });
      expect(appointment!.title).toBe('[đã ẩn danh]');
      expect(appointment!.location).toBe('');
      expect(
        (await remindersOf(created.id)).some((r) =>
          ['PENDING', 'PROCESSING'].includes(r.status),
        ),
      ).toBe(false);
      expect(
        await col('notifications').countDocuments({
          'data.customerId': oid(c),
        }),
      ).toBe(0);
      expect((await customerDoc(c))!.nextAppointmentAt).toBeNull();

      // Audit của lịch (title/location/note/outcome) bị ghi đè; khung (loại, trạng thái, giờ) giữ nguyên.
      const audits = await col('crm_audit_logs')
        .find({ customerId: oid(c), action: { $regex: '^APPOINTMENT_' } })
        .toArray();
      expect(audits.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(audits)).not.toMatch(
        /Bí mật|Kín|bệnh nền|riêng tư|0912345678/,
      );
      const fields = audits.flatMap((a) =>
        a.changes.map((change: any) => change.field),
      );
      expect(fields).toEqual(
        expect.arrayContaining([
          'appointment.title',
          'appointment.outcome',
          'appointment.status',
        ]),
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Việc hôm nay', () => {
    let c1: string; // staffA chính, staffB thành viên
    let c2: string; // staffC chính (nhóm B)
    const taskIds = (res: Res) => res.body.data.map((task: any) => task.id);

    beforeAll(async () => {
      c1 = await createCustomer('staffA');
      await addMember(c1, 'staffB');
      c2 = await createCustomer('staffC');
    });

    it('lịch hẹn theo nhóm Quá hạn/Hôm nay/Sắp tới (ngày VN), loại bỏ lịch xa hơn cửa sổ và lịch đã hoàn thành; summary khớp danh sách', async () => {
      const overdue = await insertAppointment(c1, 'staffA', noonVn(-1), {
        title: 'Quá hạn',
      });
      const today = await insertAppointment(c1, 'staffB', noonVn(0), {
        title: 'Hôm nay',
      });
      const upcoming = await insertAppointment(c1, 'staffB', noonVn(3), {
        title: 'Sắp tới',
      });
      await insertAppointment(c1, 'staffA', noonVn(20), { title: 'Quá xa' });
      await insertAppointment(c1, 'staffA', noonVn(1), {
        title: 'Đã xong',
        status: 'DONE',
      });
      await insertAppointment(c1, 'staffA', noonVn(1), {
        title: 'Đã xóa',
        deletedAt: new Date(),
      });

      const res = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
        'staffA',
      );
      expect(res.status).toBe(200);
      // Chỉ xét việc của khách c1 (các test trước để lại lịch của khách khác trong cùng phạm vi).
      const ofC1 = res.body.data.filter((task: any) => task.customer.id === c1);
      const byTitle = Object.fromEntries(
        ofC1.map((task: any) => [task.title, task]),
      );
      expect(Object.keys(byTitle).sort()).toEqual([
        'Hôm nay',
        'Quá hạn',
        'Sắp tới',
      ]);
      expect(byTitle['Quá hạn'].group).toBe('OVERDUE');
      expect(byTitle['Hôm nay'].group).toBe('TODAY');
      expect(byTitle['Sắp tới'].group).toBe('UPCOMING');
      expect(byTitle['Quá hạn']).toMatchObject({
        kind: 'APPOINTMENT',
        appointmentId: overdue,
        isPrimary: true,
        customer: { id: c1 },
        assignee: { id: ids.staffA },
      });
      expect(byTitle['Hôm nay'].appointmentId).toBe(today);
      expect(byTitle['Sắp tới'].appointmentId).toBe(upcoming);
      // Sắp theo dueAt tăng dần (Quá hạn lâu nhất lên đầu).
      expect(ofC1.map((task: any) => task.title)).toEqual([
        'Quá hạn',
        'Hôm nay',
        'Sắp tới',
      ]);

      const filtered = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&group=TODAY&limit=100',
        'staffA',
      );
      expect(
        filtered.body.data
          .filter((task: any) => task.customer.id === c1)
          .map((task: any) => task.title),
      ).toEqual(['Hôm nay']);
      expect(
        filtered.body.data.every((task: any) => task.group === 'TODAY'),
      ).toBe(true);

      const summary = await call('GET', '/crm/daily-tasks/summary', 'staffA');
      const listAll = await call('GET', '/crm/daily-tasks?limit=100', 'staffA');
      const countGroup = (group: string) =>
        listAll.body.data.filter((task: any) => task.group === group).length;
      expect(summary.body.data).toEqual({
        overdue: countGroup('OVERDUE'),
        today: countGroup('TODAY'),
        upcoming: countGroup('UPCOMING'),
      });
      expect(listAll.body.meta.total).toBe(listAll.body.data.length);
    });

    it('scope: mặc định "mine" (người thực hiện hoặc phụ trách chính); "team" chỉ Quản trị/Quản lý (NV 403) và theo phạm vi', async () => {
      const mineB = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
        'staffB',
      );
      // staffB là người thực hiện 2 lịch (Hôm nay, Sắp tới); lịch "Quá hạn" thuộc staffA (phụ trách chính) nên không phải việc của staffB.
      expect(
        mineB.body.data
          .filter((task: any) => task.customer.id === c1)
          .map((task: any) => task.title)
          .sort(),
      ).toEqual(['Hôm nay', 'Sắp tới']);
      expect(
        mineB.body.data
          .filter((task: any) => task.customer.id === c1)
          .every((task: any) => task.isPrimary === false),
      ).toBe(true);

      const staffTeam = await call(
        'GET',
        '/crm/daily-tasks?scope=team',
        'staffB',
      );
      expect(staffTeam.status).toBe(403);
      expect(
        (await call('GET', '/crm/daily-tasks/summary?scope=team', 'staffA'))
          .status,
      ).toBe(403);
      expect((await call('GET', '/crm/daily-tasks', 'editor')).status).toBe(
        403,
      );

      await insertAppointment(c2, 'staffC', noonVn(0), { title: 'Của nhóm B' });
      const team = async (who: string) =>
        (
          await call(
            'GET',
            '/crm/daily-tasks?scope=team&kinds=APPOINTMENT&limit=100',
            who,
          )
        ).body.data.map((task: any) => task.title);
      const managerOne = await team('manager1');
      expect(managerOne).toContain('Quá hạn');
      expect(managerOne).not.toContain('Của nhóm B');
      const managerTwo = await team('manager2');
      expect(managerTwo).toContain('Của nhóm B');
      expect(managerTwo).not.toContain('Quá hạn');
      const adminTitles = await team('admin');
      expect(adminTitles).toEqual(
        expect.arrayContaining(['Quá hạn', 'Của nhóm B']),
      );
      // NV nhóm B không thấy việc của khách nhóm A và ngược lại (mine nhưng vẫn qua phạm vi).
      const mineC = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
        'staffC',
      );
      const mineCTitles = mineC.body.data.map((task: any) => task.title);
      expect(mineCTitles).toContain('Của nhóm B');
      expect(mineCTitles).not.toEqual(
        expect.arrayContaining(['Quá hạn', 'Hôm nay', 'Sắp tới']),
      );
    });

    it('NV bị gỡ khỏi khách: việc và lịch của khách đó biến mất ngay khỏi Việc hôm nay', async () => {
      const cx = await createCustomer('staffA');
      await addMember(cx, 'staffB');
      await insertAppointment(cx, 'staffB', noonVn(0), { title: 'Của staffB' });
      expect(
        (
          await call(
            'GET',
            '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
            'staffB',
          )
        ).body.data.map((t: any) => t.title),
      ).toContain('Của staffB');
      const removal = await call(
        'DELETE',
        `/crm/customers/${cx}/care-team/members/${ids.staffB}`,
        'admin',
      );
      expect(removal.status).toBe(200);
      expect(
        (
          await call(
            'GET',
            '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
            'staffB',
          )
        ).body.data.map((t: any) => t.title),
      ).not.toContain('Của staffB');
    });

    it('bước tiếp theo (FOLLOW_UP): chỉ của nhật ký mới nhất và chưa có lịch hẹn; nhật ký mới hơn làm việc biến mất', async () => {
      const cx = await createCustomer('staffA');
      await addMember(cx, 'staffB');
      await call('POST', `/crm/customers/${cx}/care-logs`, 'staffA', {
        content: 'Hẹn gọi lại hôm qua',
        contactChannel: 'CALL',
        nextAction: {
          suggestion: 'Gọi chốt giá',
          dueAt: noonVn(-1).toISOString(),
        },
      });
      const list = () =>
        call('GET', '/crm/daily-tasks?kinds=FOLLOW_UP&limit=100', 'staffA');
      let tasks = (await list()).body.data.filter(
        (task: any) => task.customer.id === cx,
      );
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        kind: 'FOLLOW_UP',
        group: 'OVERDUE',
        title: 'Gọi chốt giá',
        lastCareLog: { excerpt: 'Hẹn gọi lại hôm qua' },
      });
      expect(tasks[0].careLogId).toEqual(expect.any(String));
      // Không phải việc của staffB (không phải người ghi, không phải phụ trách chính).
      expect(
        (
          await call(
            'GET',
            '/crm/daily-tasks?kinds=FOLLOW_UP&limit=100',
            'staffB',
          )
        ).body.data.filter((t: any) => t.customer.id === cx),
      ).toHaveLength(0);

      await call('POST', `/crm/customers/${cx}/care-logs`, 'staffB', {
        content: 'Đã gọi xong',
        contactChannel: 'CALL',
      });
      tasks = (await list()).body.data.filter(
        (task: any) => task.customer.id === cx,
      );
      expect(tasks).toHaveLength(0);
    });

    it('dịp đặc biệt và khách lâu chưa chăm sóc xuất hiện đúng nhóm/người; phân trang chính xác khi ghép nhiều nguồn', async () => {
      const today = todayKey();
      const cx = await createCustomer('staffA');
      await addMember(cx, 'staffB');
      const version = (
        await call('GET', `/crm/customers/${cx}/persona`, 'staffA')
      ).body.data.version;
      await call('PATCH', `/crm/customers/${cx}/persona`, 'staffA', {
        version,
        values: [
          {
            fieldKey: 'birthday',
            value: { valueDate: `1992${today.slice(4)}` },
            source: 'CUSTOMER_SHARED',
          },
        ],
      });
      const staleCustomer = await createCustomer('staffA');
      const old = new Date(Date.now() - 40 * DAY_MS);
      await col('customers').updateOne(
        { _id: oid(staleCustomer) },
        { $set: { lastCareLogAt: old } },
      );

      const occasionA = (
        await call('GET', '/crm/daily-tasks?kinds=OCCASION&limit=100', 'staffA')
      ).body.data.filter((task: any) => task.customer.id === cx);
      expect(occasionA).toHaveLength(1);
      expect(occasionA[0]).toMatchObject({
        kind: 'OCCASION',
        group: 'TODAY',
        isPrimary: true,
      });
      expect(occasionA[0].title).toMatch(/hôm nay$/);
      // Thành viên (không phải phụ trách chính) cũng thấy dịp đặc biệt của khách mình chăm sóc.
      expect(
        (
          await call(
            'GET',
            '/crm/daily-tasks?kinds=OCCASION&limit=100',
            'staffB',
          )
        ).body.data.filter((t: any) => t.customer.id === cx),
      ).toHaveLength(1);

      const staleA = (
        await call(
          'GET',
          '/crm/daily-tasks?kinds=STALE_CUSTOMER&limit=100',
          'staffA',
        )
      ).body.data.filter((task: any) => task.customer.id === staleCustomer);
      expect(staleA).toHaveLength(1);
      expect(staleA[0]).toMatchObject({
        group: 'TODAY',
        title: '40 ngày chưa chăm sóc',
        assignee: { id: ids.staffA },
      });
      expect(
        (
          await call(
            'GET',
            '/crm/daily-tasks?kinds=STALE_CUSTOMER&limit=100',
            'staffB',
          )
        ).body.data.filter((t: any) => t.customer.id === staleCustomer),
      ).toHaveLength(0);

      // Phân trang: gộp tất cả nguồn, trang liên tiếp không trùng/không sót, tổng khớp.
      const all = await call(
        'GET',
        '/crm/daily-tasks?scope=team&limit=100',
        'admin',
      );
      const total = all.body.meta.total;
      expect(total).toBeGreaterThan(5);
      const seen: string[] = [];
      for (let page = 1; page <= Math.ceil(total / 4); page += 1) {
        const part = await call(
          'GET',
          `/crm/daily-tasks?scope=team&limit=4&page=${page}`,
          'admin',
        );
        expect(part.body.meta).toMatchObject({ total, page, limit: 4 });
        seen.push(...taskIds(part));
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
      expect(seen).toEqual(taskIds(all));
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Hộp thông báo và cài đặt thông báo', () => {
    it('sự kiện sinh thông báo: được phân khách (không báo cho chính người làm), ghi chú mới (gộp theo khoảng debounce), đề nghị tham gia gửi người duyệt và kết quả gửi người đề nghị', async () => {
      // Cửa sổ gộp rộng (2 giờ) để hai ghi chú liên tiếp chắc chắn cùng một khung.
      await call('PATCH', '/crm/settings', 'admin', {
        careLogNotifyDebounceMinutes: 120,
      });
      const c = await createCustomer('staffA');
      // Quản trị thêm staffB vào nhóm: chỉ người được thêm (không phải người làm) nhận.
      await addMember(c, 'staffB');
      const assigned = await notificationsOf('staffB', {
        type: 'CUSTOMER_ASSIGNED',
        'data.customerId': oid(c),
      });
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toMatchObject({
        title: 'Bạn được phân chăm sóc khách mới',
        priority: 'NORMAL',
        pushStatus: 'SKIPPED',
      });
      expect(String(assigned[0].data.customerId)).toBe(c);
      expect(assigned[0].data.deepLink).toBe(`/crm/customers/${c}`);
      expect(
        await notificationsOf('admin', { type: 'CUSTOMER_ASSIGNED' }),
      ).toHaveLength(0);

      // Quản trị tạo khách và phân cho staffA làm phụ trách chính => HIGH.
      const created = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
      });
      const high = await notificationsOf('staffA', {
        type: 'CUSTOMER_ASSIGNED',
        'data.customerId': oid(created),
      });
      expect(high).toHaveLength(1);
      expect(high[0].priority).toBe('HIGH');

      // Hai ghi chú liên tiếp của staffA: staffB chỉ nhận MỘT thông báo (debounce), staffA không tự nhận.
      await call('POST', `/crm/customers/${c}/care-logs`, 'staffA', {
        content: 'Ghi chú 1',
        contactChannel: 'CALL',
      });
      await call('POST', `/crm/customers/${c}/care-logs`, 'staffA', {
        content: 'Ghi chú 2',
        contactChannel: 'ZALO',
      });
      const logNotes = await notificationsOf('staffB', {
        type: 'CARE_LOG_ADDED',
        'data.customerId': oid(c),
      });
      expect(logNotes).toHaveLength(1);
      await call('PATCH', '/crm/settings', 'admin', {
        careLogNotifyDebounceMinutes: 10,
      });
      expect(logNotes[0].body).toContain('staffA');
      expect(
        await notificationsOf('staffA', {
          type: 'CARE_LOG_ADDED',
          'data.customerId': oid(c),
        }),
      ).toHaveLength(0);

      // Đề nghị tham gia: staffD (ngoài phạm vi) gửi => phụ trách chính staffA + Quản lý nhóm A nhận, người gửi thì không.
      const requestRes = await call(
        'POST',
        '/crm/care-team-requests',
        'staffD',
        { customerRef: c, message: 'Em quen khách này' },
      );
      expect(requestRes.status).toBe(201);
      const toPrimary = await notificationsOf('staffA', {
        type: 'CARE_TEAM_JOIN_REQUESTED',
      });
      const toManager = await notificationsOf('manager1', {
        type: 'CARE_TEAM_JOIN_REQUESTED',
      });
      expect([toPrimary.length, toManager.length]).toEqual([1, 1]);
      expect(toPrimary[0].body).not.toContain('Khách ');
      expect(
        await notificationsOf('staffD', { type: 'CARE_TEAM_JOIN_REQUESTED' }),
      ).toHaveLength(0);

      const approve = await call(
        'PATCH',
        `/crm/care-team-requests/${requestRes.body.data.id}`,
        'staffA',
        { status: 'APPROVED' },
      );
      expect(approve.status).toBe(200);
      const resolved = await notificationsOf('staffD', {
        type: 'CARE_TEAM_JOIN_RESOLVED',
      });
      expect(resolved).toHaveLength(1);
      expect(resolved[0].title).toBe('Đề nghị tham gia được duyệt');
    });

    it('hai người cùng ghi nhật ký ĐỒNG THỜI cho một khách: cả hai thành công (không 500 do khóa chống trùng thông báo), người thứ ba chỉ nhận một thông báo gộp', async () => {
      await call('PATCH', '/crm/settings', 'admin', {
        careLogNotifyDebounceMinutes: 120,
      });
      try {
        const c = await createCustomer('staffA');
        await addMember(c, 'staffB');
        await addMember(c, 'staffD');
        for (let round = 0; round < 3; round += 1) {
          const results = await Promise.all(
            ['staffA', 'staffB'].map((who) =>
              call('POST', `/crm/customers/${c}/care-logs`, who, {
                content: `Ghi đồng thời ${who} ${round}`,
                contactChannel: 'CALL',
              }),
            ),
          );
          expect(results.map((res) => res.status)).toEqual([201, 201]);
        }
        const toD = await notificationsOf('staffD', {
          type: 'CARE_LOG_ADDED',
          'data.customerId': oid(c),
        });
        expect(toD).toHaveLength(1);
      } finally {
        await call('PATCH', '/crm/settings', 'admin', {
          careLogNotifyDebounceMinutes: 10,
        });
      }
    });

    it('cảnh báo bảo mật: vượt ngưỡng xem SĐT trong giờ gửi đúng MỘT thông báo SECURITY_ALERT (HIGH) cho mỗi Quản trị, không chứa SĐT', async () => {
      const c = await createCustomer('staffA');
      const phone = (await customerDoc(c))!.phone as string;
      await call('PATCH', '/crm/settings', 'admin', {
        phoneViewAlertPerHour: 2,
      });
      try {
        for (let index = 0; index < 4; index += 1) {
          const res = await call(
            'POST',
            `/crm/customers/${c}/phone-views`,
            'staffA',
            { purpose: 'VIEW' },
          );
          expect(res.status).toBe(201);
        }
      } finally {
        await call('PATCH', '/crm/settings', 'admin', {
          phoneViewAlertPerHour: 200,
        });
      }
      for (const admin of ['admin', 'admin2']) {
        const alerts = await notificationsOf(admin, { type: 'SECURITY_ALERT' });
        expect([admin, alerts.length]).toEqual([admin, 1]);
        expect(alerts[0].priority).toBe('HIGH');
        expect(alerts[0].body).toContain('staffA');
        expect(JSON.stringify(alerts[0])).not.toContain(
          phone.replace('+84', ''),
        );
        expect(alerts[0].data.deepLink).toContain(ids.staffA);
      }
      expect(
        await notificationsOf('manager1', { type: 'SECURITY_ALERT' }),
      ).toHaveLength(0);
      expect(
        await notificationsOf('staffA', { type: 'SECURITY_ALERT' }),
      ).toHaveLength(0);
    });

    it('GET /notifications: chỉ thông báo của chính mình, mới nhất trước, phân trang { data, meta }, lọc isRead/types; EDITOR 403, chưa đăng nhập 401', async () => {
      const mine = await call('GET', '/notifications?limit=100', 'staffB');
      expect(mine.status).toBe(200);
      const total = await col('notifications').countDocuments({
        userId: oid(ids.staffB),
      });
      expect(mine.body.meta).toEqual({
        total,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
      const created = mine.body.data.map((n: any) => n.createdAt);
      expect([...created].sort().reverse()).toEqual(created);
      expect(mine.body.data[0]).toEqual({
        id: expect.any(String),
        type: expect.any(String),
        title: expect.any(String),
        body: expect.any(String),
        data: expect.objectContaining({ deepLink: expect.any(String) }),
        priority: expect.stringMatching(/^(HIGH|NORMAL)$/),
        readAt: null,
        createdAt: expect.any(String),
      });
      expect(JSON.stringify(mine.body)).not.toContain(
        String(ids.staffA) + '"userId',
      );

      const paged = await call(
        'GET',
        '/notifications?limit=2&page=2',
        'staffB',
      );
      expect(paged.body.meta).toMatchObject({
        total,
        page: 2,
        limit: 2,
        totalPages: Math.ceil(total / 2),
      });
      expect(paged.body.data).toHaveLength(Math.min(2, Math.max(0, total - 2)));

      const typed = await call(
        'GET',
        '/notifications?types=CUSTOMER_ASSIGNED,CARE_LOG_ADDED&limit=100',
        'staffB',
      );
      expect(typed.body.data.length).toBeGreaterThan(0);
      expect(
        typed.body.data.every((n: any) =>
          ['CUSTOMER_ASSIGNED', 'CARE_LOG_ADDED'].includes(n.type),
        ),
      ).toBe(true);
      expect(
        (await call('GET', '/notifications?types=KHONG_CO', 'staffB')).status,
      ).toBe(400);
      expect(
        (await call('GET', '/notifications?isRead=maybe', 'staffB')).status,
      ).toBe(400);
      expect((await call('GET', '/notifications', 'editor')).status).toBe(403);
      expect((await call('GET', '/notifications', null)).status).toBe(401);
    });

    it('đánh dấu đã đọc/chưa đọc: giữ mốc đọc đầu tiên, đếm chưa đọc đúng; thông báo người khác trả 404; hàng loạt theo ids/before/tất cả chỉ ảnh hưởng của mình', async () => {
      const listRes = await call('GET', '/notifications?limit=100', 'staffB');
      const list = listRes.body.data;
      const unreadBefore = (
        await call('GET', '/notifications/unread-count', 'staffB')
      ).body.data.count;
      expect(unreadBefore).toBe(listRes.body.meta.total);
      const target = list[0].id;

      const read = await call('PATCH', `/notifications/${target}`, 'staffB', {
        isRead: true,
      });
      expect(read.status).toBe(200);
      const firstReadAt = read.body.data.readAt;
      expect(firstReadAt).toEqual(expect.any(String));
      await new Promise((resolve) => setTimeout(resolve, 15));
      const again = await call('PATCH', `/notifications/${target}`, 'staffB', {
        isRead: true,
      });
      expect(again.body.data.readAt).toBe(firstReadAt);
      expect(
        (await call('GET', '/notifications/unread-count', 'staffB')).body.data
          .count,
      ).toBe(unreadBefore - 1);
      const unread = await call('PATCH', `/notifications/${target}`, 'staffB', {
        isRead: false,
      });
      expect(unread.body.data.readAt).toBeNull();

      // Của người khác / không tồn tại: 404 như nhau.
      const foreign = await call(
        'PATCH',
        `/notifications/${target}`,
        'staffA',
        { isRead: true },
      );
      const missing = await call(
        'PATCH',
        `/notifications/${String(new Types.ObjectId())}`,
        'staffB',
        { isRead: true },
      );
      expect([foreign.status, foreign.body.errorCode]).toEqual([
        404,
        'RESOURCE_NOT_FOUND',
      ]);
      expect(missing.body.errorCode).toBe(foreign.body.errorCode);
      expect(
        (await col('notifications').findOne({ _id: oid(target) }))!.readAt,
      ).toBeNull();

      // Hàng loạt: ids chỉ của mình (id người khác bị bỏ qua), rồi before, rồi tất cả.
      const staffAOne = (await call('GET', '/notifications?limit=1', 'staffA'))
        .body.data[0].id;
      const byIds = await call('PATCH', '/notifications', 'staffB', {
        isRead: true,
        ids: [list[1].id, staffAOne],
      });
      expect(byIds.body.data).toEqual({ updated: 1 });
      expect(
        (await col('notifications').findOne({ _id: oid(staffAOne) }))!.readAt,
      ).toBeNull();
      const beforeAll = await call('PATCH', '/notifications', 'staffB', {
        isRead: true,
        before: new Date(Date.now() - DAY_MS).toISOString(),
      });
      expect(beforeAll.body.data).toEqual({ updated: 0 });
      const everything = await call('PATCH', '/notifications', 'staffB', {
        isRead: true,
      });
      expect(everything.body.data.updated).toBe(unreadBefore - 1);
      expect(
        (await call('GET', '/notifications/unread-count', 'staffB')).body.data
          .count,
      ).toBe(0);
      expect(
        (await call('GET', '/notifications/unread-count', 'staffA')).body.data
          .count,
      ).toBeGreaterThan(0);
      expect(
        (await call('PATCH', '/notifications', 'staffB', { isRead: false }))
          .status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', '/notifications', 'staffB', {
            isRead: true,
            ids: ['x'],
          })
        ).status,
      ).toBe(400);
    });

    it('cài đặt thông báo: mặc định bật đủ mọi loại; PUT một phần giữ phần còn lại; loại lạ/định dạng sai 400; giờ yên lặng đặt/xóa được; người khác không bị ảnh hưởng', async () => {
      const initial = await call(
        'GET',
        '/notification-preferences/me',
        'staffD',
      );
      expect(initial.status).toBe(200);
      expect(initial.body.data.quietHours).toBeNull();
      expect(Object.keys(initial.body.data.types)).toEqual(
        expect.arrayContaining([
          'CUSTOMER_ASSIGNED',
          'APPOINTMENT_DUE',
          'FOLLOW_UP_DUE',
          'CARE_LOG_ADDED',
          'STALE_CUSTOMER',
          'CUSTOMER_OCCASION',
          'SECURITY_ALERT',
        ]),
      );
      expect(
        Object.values(initial.body.data.types).every(
          (p: any) => p.push && p.inApp,
        ),
      ).toBe(true);

      const saved = await call(
        'PUT',
        '/notification-preferences/me',
        'staffD',
        {
          types: { CARE_LOG_ADDED: { push: true, inApp: false } },
          quietHours: { start: '22:00', end: '06:30' },
        },
      );
      expect(saved.status).toBe(200);
      expect(saved.body.data.types.CARE_LOG_ADDED).toEqual({
        push: true,
        inApp: false,
      });
      expect(saved.body.data.types.APPOINTMENT_DUE).toEqual({
        push: true,
        inApp: true,
      });
      expect(saved.body.data.quietHours).toEqual({
        start: '22:00',
        end: '06:30',
      });

      const second = await call(
        'PUT',
        '/notification-preferences/me',
        'staffD',
        {
          types: { STALE_CUSTOMER: { push: false, inApp: true } },
        },
      );
      expect(second.body.data.types.CARE_LOG_ADDED.inApp).toBe(false);
      expect(second.body.data.types.STALE_CUSTOMER).toEqual({
        push: false,
        inApp: true,
      });
      expect(second.body.data.quietHours).toEqual({
        start: '22:00',
        end: '06:30',
      });
      const cleared = await call(
        'PUT',
        '/notification-preferences/me',
        'staffD',
        { types: {}, quietHours: null },
      );
      expect(cleared.body.data.quietHours).toBeNull();
      expect(
        await col('notification_preferences').countDocuments({
          userId: oid(ids.staffD),
        }),
      ).toBe(1);
      expect(
        (await call('GET', '/notification-preferences/me', 'staffA')).body.data
          .types.CARE_LOG_ADDED.inApp,
      ).toBe(true);

      for (const bad of [
        { types: { KHONG_CO: { push: true, inApp: true } } },
        { types: { CARE_LOG_ADDED: { push: 'yes', inApp: true } } },
        { types: { CARE_LOG_ADDED: { push: true } } },
        { types: { CARE_LOG_ADDED: { push: true, inApp: true, extra: 1 } } },
        {
          types: { CARE_LOG_ADDED: { push: true, inApp: true } },
          quietHours: { start: '22:00', end: '22:00' },
        },
        { types: {}, quietHours: { start: '25:00', end: '06:00' } },
        {},
      ]) {
        expect([
          JSON.stringify(bad),
          (await call('PUT', '/notification-preferences/me', 'staffD', bad))
            .status,
        ]).toEqual([JSON.stringify(bad), 400]);
      }
      expect(
        (await call('GET', '/notification-preferences/me', 'editor')).status,
      ).toBe(403);
    });

    it('inApp=false cho một loại: thông báo loại đó không được ghi (không phải ghi rồi ẩn); loại khác vẫn nhận', async () => {
      const c = await createCustomer('staffA');
      await call('PUT', '/notification-preferences/me', 'staffB', {
        types: { CARE_LOG_ADDED: { push: true, inApp: false } },
      });
      try {
        await addMember(c, 'staffB');
        await call('POST', `/crm/customers/${c}/care-logs`, 'staffA', {
          content: 'Ghi chú',
          contactChannel: 'CALL',
        });
      } finally {
        await call('PUT', '/notification-preferences/me', 'staffB', {
          types: { CARE_LOG_ADDED: { push: true, inApp: true } },
        });
      }
      expect(
        await notificationsOf('staffB', {
          type: 'CARE_LOG_ADDED',
          'data.customerId': oid(c),
        }),
      ).toHaveLength(0);
      expect(
        await notificationsOf('staffB', {
          type: 'CUSTOMER_ASSIGNED',
          'data.customerId': oid(c),
        }),
      ).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Lịch hẹn gắn dự án (G7)', () => {
    let c: string; // staffA chính
    let projectA: string;
    let projectB: string;
    let projectOff: string; // dự án đã ngừng hoạt động
    const projectOf = (res: Res) => res.body.data.project;
    const labelOf = (code: string) => `Dự án ${code}${RUN_ID}`;

    const createProject = async (code: string): Promise<string> => {
      const res = await call('POST', '/crm/projects', 'admin', {
        name: labelOf(code),
        code: `${code}${RUN_ID}`,
      });
      expect(res.status).toBe(201);
      return res.body.data.id;
    };

    beforeAll(async () => {
      c = await createCustomer('staffA');
      projectA = await createProject('G7A');
      projectB = await createProject('G7B');
      projectOff = await createProject('G7O');
      const off = await call('PATCH', `/crm/projects/${projectOff}`, 'admin', {
        isActive: false,
      });
      expect(off.status).toBe(200);
    });

    it('tạo lịch có dự án hợp lệ: lưu projectId, response/chi tiết trả project {id, label}, audit ghi tên dự án; không gửi hoặc null vẫn tạo được', async () => {
      const res = await createAppointment('staffA', c, { projectId: projectA });
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      expect(projectOf(res)).toEqual({ id: projectA, label: labelOf('G7A') });
      const doc = await col('appointments').findOne({
        _id: oid(res.body.data.id),
      });
      expect(String(doc!.projectId)).toBe(projectA);
      const detail = await call(
        'GET',
        `/crm/appointments/${res.body.data.id}`,
        'staffA',
      );
      expect(projectOf(detail)).toEqual({
        id: projectA,
        label: labelOf('G7A'),
      });
      const audit = await col('crm_audit_logs').findOne({
        action: 'APPOINTMENT_CREATED',
        entityId: oid(res.body.data.id),
      });
      expect(audit!.changes).toContainEqual({
        field: 'appointment.project',
        from: null,
        to: labelOf('G7A'),
      });

      const omitted = await createAppointment('staffA', c);
      const explicitNull = await createAppointment('staffA', c, {
        projectId: null,
      });
      expect([omitted.status, projectOf(omitted)]).toEqual([201, null]);
      expect([explicitNull.status, projectOf(explicitNull)]).toEqual([
        201,
        null,
      ]);
    });

    it('dự án không tồn tại hoặc đã ngừng hoạt động => 400 VALIDATION_FAILED (field projectId) và KHÔNG tạo lịch; id sai định dạng => 400', async () => {
      const before = await col('appointments').countDocuments({
        customerId: oid(c),
      });
      for (const projectId of [String(new Types.ObjectId()), projectOff]) {
        const res = await createAppointment('staffA', c, { projectId });
        expect([
          res.status,
          res.body.errorCode,
          res.body.details?.field,
        ]).toEqual([400, 'VALIDATION_FAILED', 'projectId']);
      }
      expect(
        (await createAppointment('staffA', c, { projectId: 'abc' })).status,
      ).toBe(400);
      expect(
        await col('appointments').countDocuments({ customerId: oid(c) }),
      ).toBe(before);
    });

    it('sửa lịch: đổi dự án, gỡ bằng null, bỏ trống thì giữ; dự án bị ngừng sau khi gắn vẫn trả tên và gửi lại đúng dự án đó không bị chặn, nhưng không đổi sang dự án ngừng', async () => {
      const created = await mustCreate('staffA', c, { projectId: projectA });
      const url = `/crm/appointments/${created.id}`;

      const keep = await call('PATCH', url, 'staffA', { title: 'Đổi tiêu đề' });
      expect(projectOf(keep)).toMatchObject({ id: projectA });

      const swap = await call('PATCH', url, 'staffA', { projectId: projectB });
      expect(projectOf(swap)).toEqual({ id: projectB, label: labelOf('G7B') });
      const audit = await col('crm_audit_logs')
        .find({ action: 'APPOINTMENT_UPDATED', entityId: oid(created.id) })
        .toArray();
      expect(audit.flatMap((a) => a.changes)).toContainEqual({
        field: 'appointment.project',
        from: labelOf('G7A'),
        to: labelOf('G7B'),
      });

      const rejected = await call('PATCH', url, 'staffA', {
        projectId: projectOff,
      });
      expect([
        rejected.status,
        rejected.body.errorCode,
        rejected.body.details?.field,
      ]).toEqual([400, 'VALIDATION_FAILED', 'projectId']);

      await call('PATCH', `/crm/projects/${projectB}`, 'admin', {
        isActive: false,
      });
      const read = await call('GET', url, 'staffA');
      expect(projectOf(read)).toEqual({ id: projectB, label: labelOf('G7B') });
      const resend = await call('PATCH', url, 'staffA', {
        projectId: projectB,
        note: 'ghi chú',
      });
      expect([resend.status, projectOf(resend)?.id]).toEqual([200, projectB]);
      await call('PATCH', `/crm/projects/${projectB}`, 'admin', {
        isActive: true,
      });

      const cleared = await call('PATCH', url, 'staffA', { projectId: null });
      expect([cleared.status, projectOf(cleared)]).toEqual([200, null]);
      const doc = await col('appointments').findOne({ _id: oid(created.id) });
      expect(doc!.projectId).toBeNull();
    });

    it('lọc danh sách theo projectId chỉ trả lịch của dự án đó; projectId sai định dạng => 400', async () => {
      const onlyP = await createProject('G7F');
      const withP = await mustCreate('staffA', c, { projectId: onlyP });
      await mustCreate('staffA', c, { projectId: projectA });
      await mustCreate('staffA', c);
      const from = inDays(-1).slice(0, 10);
      const to = inDays(10).slice(0, 10);
      const res = await call(
        'GET',
        `/crm/appointments?from=${from}&to=${to}&projectId=${onlyP}&limit=100`,
        'staffA',
      );
      expect(res.status).toBe(200);
      expect(res.body.data.map((a: any) => a.id)).toEqual([withP.id]);
      expect(res.body.meta.total).toBe(1);
      expect(
        (
          await call(
            'GET',
            `/crm/appointments?from=${from}&to=${to}&projectId=zzz`,
            'staffA',
          )
        ).status,
      ).toBe(400);
    });

    it('Việc hôm nay: task lịch hẹn có dự án trả `project` riêng của lịch, `customer.projects` vẫn là dự án khách quan tâm; task không dự án có `project: null`', async () => {
      const cust = await createCustomer('staffA', {
        interestedProjectIds: [projectA],
      });
      const withProject = await insertAppointment(cust, 'staffA', noonVn(1), {
        title: 'Có dự án',
        projectId: oid(projectB),
      });
      await insertAppointment(cust, 'staffA', noonVn(2), {
        title: 'Không dự án',
      });
      const res = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
        'staffA',
      );
      const ofCust = Object.fromEntries(
        res.body.data
          .filter((task: any) => task.customer.id === cust)
          .map((task: any) => [task.title, task]),
      );
      expect(ofCust['Có dự án'].appointmentId).toBe(withProject);
      expect(ofCust['Có dự án'].project).toEqual({
        id: projectB,
        label: labelOf('G7B'),
      });
      expect(ofCust['Có dự án'].customer.projects).toEqual([
        { id: projectA, label: labelOf('G7A') },
      ]);
      expect(ofCust['Không dự án'].project).toBeNull();
      expect(ofCust['Không dự án'].customer.projects).toEqual([
        { id: projectA, label: labelOf('G7A') },
      ]);
    });

    it('nextAction.appointment nhận projectId: lịch sinh ra mang dự án; dự án ngừng hoạt động => 400 và hoàn tác cả nhật ký', async () => {
      const ok = await call('POST', `/crm/customers/${c}/care-logs`, 'staffA', {
        content: 'Hẹn xem nhà',
        contactChannel: 'CALL',
        nextAction: {
          dueAt: inDays(6),
          appointment: { type: 'SITE_VISIT', projectId: projectA },
        },
      });
      expect([ok.status, ok.body.message]).toEqual([201, undefined]);
      const appointment = await call(
        'GET',
        `/crm/appointments/${ok.body.data.nextAction.appointmentId}`,
        'staffA',
      );
      expect(projectOf(appointment)).toMatchObject({ id: projectA });

      const logsBefore = await col('care_logs').countDocuments({
        customerId: oid(c),
      });
      // Ảnh chờ gắn: bước gắn ảnh chạy TRƯỚC khi tạo lịch, nên chỉ khi rollback thật thì ảnh mới không bị gắn.
      const attachmentId = new Types.ObjectId();
      await col('crm_attachments').insertOne({
        _id: attachmentId,
        customerId: oid(c),
        careLogId: null,
        uploaderId: oid(ids.staffA),
        kind: 'CARE_LOG_IMAGE',
        fileKey: `g7-${RUN_ID}`,
        thumbKey: null,
        originalName: 'g7.jpg',
        mimeType: 'image/jpeg',
        size: 1,
        status: 'READY',
        createdAt: new Date(),
      });
      process.env.FEATURE_CRM_ATTACHMENTS = 'true';
      let bad: Res;
      try {
        bad = await call('POST', `/crm/customers/${c}/care-logs`, 'staffA', {
          content: 'Hẹn xem nhà 2',
          contactChannel: 'CALL',
          attachmentIds: [String(attachmentId)],
          nextAction: {
            dueAt: inDays(6),
            appointment: { type: 'SITE_VISIT', projectId: projectOff },
          },
        });
      } finally {
        delete process.env.FEATURE_CRM_ATTACHMENTS;
      }
      expect([bad.status, bad.body.details?.field]).toEqual([400, 'projectId']);
      expect(
        await col('crm_attachments').findOne({ _id: attachmentId }),
      ).toMatchObject({ status: 'READY', careLogId: null });
      expect(
        await col('care_logs').countDocuments({ customerId: oid(c) }),
      ).toBe(logsBefore);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Hạ tầng BullMQ (Redis thật)', () => {
    const queueName = `crm-scheduler-it-${RUN_ID}`;
    const configFor = (workers: string) =>
      ({
        get: (key: string) =>
          key === 'QUEUE_WORKERS_ENABLED' ? workers : process.env[key],
      }) as unknown as ConfigService;

    it('job lặp đăng ký idempotent từ nhiều instance (đúng 1 scheduler), worker nhận job theo nhịp và đóng gọn khi tắt; runtime tắt thì không mở kết nối nào', async () => {
      const config = configFor('true');
      const instanceA = new QueueRuntimeService(config);
      const instanceB = new QueueRuntimeService(config);
      const spec = { id: 'tick', repeat: { every: 150 }, jobName: 'tick' };
      const probe = new Queue(queueName, {
        connection: buildRedisOptions(config),
        prefix: buildBullPrefix(config),
      });
      const handled: string[] = [];
      try {
        await Promise.all([
          instanceA.upsertSchedulers(queueName, [spec]),
          instanceB.upsertSchedulers(queueName, [spec]),
        ]);
        await instanceA.upsertSchedulers(queueName, [spec]); // "khởi động lại"
        expect(await probe.getJobSchedulersCount()).toBe(1);

        instanceA.registerWorker(queueName, (job) => {
          handled.push(String(job.id));
          return Promise.resolve();
        });
        const deadline = Date.now() + 8000;
        while (handled.length < 3 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(handled.length).toBeGreaterThanOrEqual(3);
        // Mỗi nhịp là một job riêng (jobId không trùng): không xử lý một job hai lần.
        expect(new Set(handled).size).toBe(handled.length);
      } finally {
        await instanceA.onApplicationShutdown();
        await instanceB.onApplicationShutdown();
        await probe.obliterate({ force: true }).catch(() => undefined);
        await probe.close();
      }

      const disabled = new QueueRuntimeService(configFor('false'));
      expect(disabled.isEnabled()).toBe(false);
      await disabled.upsertSchedulers(queueName, [spec]);
      disabled.registerWorker(queueName, () => Promise.resolve());
      expect(await disabled.add(queueName, 'x', {}, { jobId: 'x' })).toBeNull();
      await disabled.onApplicationShutdown();
    });
  });
});
