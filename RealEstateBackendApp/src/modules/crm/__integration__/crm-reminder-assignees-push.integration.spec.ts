/**
 * INTEGRATION — T-58 (FR-30/FR-33): nhắc `APPOINTMENT_DUE` chỉ gửi (thông báo trong ứng dụng VÀ push) cho đúng những người
 * được chọn làm người thực hiện (`assigneeIds`) giao với tập hợp lệ HIỆN TẠI của khách (careTeam ACTIVE, Manager nhóm chủ,
 * người tạo). Đi hết chuỗi thật: tạo lịch qua HTTP -> `ReminderDispatchService.dispatchDue` -> `NotificationDispatcher`
 * -> job `push.send` -> `PushQueueWorker` -> nhà cung cấp push. Nhà cung cấp push và hàng đợi BullMQ là bản giả: job được
 * bắt lại rồi gọi worker trực tiếp. MongoDB Replica Set (mongodb-memory-server) + Redis THẬT (đặt `REDIS_URL`).
 *
 * Chạy: npx jest --testRegex "crm-reminder-assignees-push.integration.spec.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand
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
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.fixture';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { NotificationPushStatus } from '../../notifications/notification.constants';
import { buildPushAuthAad } from '../../notifications/push/push-endpoint.policy';
import { PUSH_PROVIDER } from '../../notifications/push/push-provider.interface';
import { PushQueueWorker } from '../../notifications/push/push-queue-worker.service';
import { TeamsModule } from '../../teams/teams.module';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { UsersModule } from '../../users/users.module';
import { PiiCryptoService } from '.././common/crypto/pii-crypto.service';
import { CrmModule } from '.././crm.module';
import { ReminderDispatchService } from '.././reminders/reminder-dispatch.service';
import { CrmSeedService } from '.././seed/crm-seed.service';

jest.setTimeout(300_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

describe('CRM nhắc lịch hẹn -> thông báo + push chỉ tới người thực hiện hợp lệ (T-58, FR-33)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let crypto: PiiCryptoService;
  let worker: PushQueueWorker;
  let dispatch: ReminderDispatchService;
  const queueAdd = jest.fn();
  const send = jest.fn();

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const endpoints: Record<string, string> = {};
  let phoneSeq = 0;

  const col = (name: string) => connection.collection(name);
  const oid = (id: string) => new Types.ObjectId(id);

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    as: string,
    body?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${tokens[as]}` },
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
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

  /** Mỗi người có đúng một thiết bị push hợp lệ (auth mã hóa đúng như đăng ký thật). */
  const createDevice = async (key: string) => {
    const endpointHash = key.padEnd(64, 'e');
    endpoints[key] = `https://fcm.googleapis.com/fcm/send/SECRET-${key}`;
    await col('push_subscriptions').insertOne({
      userId: oid(ids[key]),
      endpoint: endpoints[key],
      endpointHash,
      keys: {
        p256dh: 'p256dh-public',
        authEnc: crypto.encrypt(
          `auth-${key}`,
          buildPushAuthAad(ids[key], endpointHash),
        ),
      },
      expirationTime: null,
      platform: 'OTHER',
      deviceLabel: `Thiết bị ${key}`,
      lastSeenAt: new Date(),
      revokedAt: null,
      revokedReason: null,
      purgeAt: null,
    });
  };

  const createCustomer = async (as: string): Promise<string> => {
    const res = await call('POST', '/crm/customers', as, {
      fullName: 'Khách nhắc lịch',
      phone: `095${String(1_000_000 + ++phoneSeq)}`,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  };

  const createAppointment = async (
    as: string,
    customerId: string,
    assigneeIds: string[],
  ) => {
    const res = await call('POST', '/crm/appointments', as, {
      customerId,
      type: 'SITE_VISIT',
      startAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
      assigneeIds,
      remindBeforeMinutes: [60],
    });
    expect([res.status, res.body.message]).toEqual([201, undefined]);
    return res.body.data as { id: string; startAt: string };
  };

  const notificationsOf = (key: string, appointmentId: string) =>
    col('notifications')
      .find({
        userId: oid(ids[key]),
        type: 'APPOINTMENT_DUE',
        'data.appointmentId': oid(appointmentId),
      })
      .toArray();

  const sentTo = (key: string) =>
    send.mock.calls.filter(
      ([subscription]) => subscription?.endpoint === endpoints[key],
    );

  /** Chạy worker cho mọi job `push.send` đã xếp hàng kể từ lần `queueAdd.mockClear()` gần nhất. */
  const runQueuedJobs = async () => {
    for (const queued of queueAdd.mock.calls) {
      await worker.handle({
        name: 'push.send',
        data: queued[2] as { notificationId: string },
        attemptsMade: 0,
        opts: { attempts: 5 },
      });
    }
  };

  const fireReminder = (appointment: { startAt: string }) => {
    return dispatch.dispatchDue(
      new Date(new Date(appointment.startAt).getTime() - 30 * MINUTE_MS),
    );
  };

  beforeAll(async () => {
    process.env.CRM_ENABLED = 'true';
    process.env.CRM_PUSH_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-rem-push-${RUN_ID}:`;
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
      .overrideProvider(PUSH_PROVIDER)
      .useValue({
        name: 'fake',
        // Mô phỏng đúng hợp đồng của `PushProviderFactory`: cờ tắt thì `NoopPushProvider` (initialStatus SKIPPED).
        // Đọc cờ tại thời điểm gọi để test được cả hai trạng thái; logic nhắc/Dispatcher vẫn là bản thật.
        isEnabled: () => process.env.CRM_PUSH_ENABLED === 'true',
        initialStatus: () =>
          process.env.CRM_PUSH_ENABLED === 'true'
            ? NotificationPushStatus.PENDING
            : NotificationPushStatus.SKIPPED,
        send: send.mockResolvedValue({ outcome: 'SENT', statusCode: 201 }),
      })
      .overrideProvider(QueueRuntimeService)
      .useValue({
        isEnabled: () => false,
        add: queueAdd,
        registerWorker: jest.fn(),
        upsertSchedulers: jest.fn().mockResolvedValue(undefined),
      })
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
    crypto = app.get(PiiCryptoService);
    worker = app.get(PushQueueWorker);
    dispatch = app.get(ReminderDispatchService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('manager2', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    ids.teamA = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm A',
        code: 'TEAMA',
        managerIds: [ids.manager1],
      })
    ).body.data.id;
    for (const user of ['manager1', 'staffA', 'staffB']) {
      const res = await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
        teamId: ids.teamA,
      });
      expect(res.status).toBe(200);
    }
    for (const user of ['admin', 'manager1', 'manager2', 'staffA', 'staffB']) {
      await createDevice(user);
    }
  });

  afterAll(async () => {
    delete process.env.CRM_ENABLED;
    delete process.env.CRM_PUSH_ENABLED;
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  beforeEach(() => {
    queueAdd.mockClear();
    send.mockClear();
    process.env.CRM_PUSH_ENABLED = 'true';
  });

  it('Manager nhóm chủ ngoài careTeam được chọn: nhận thông báo VÀ push; thành viên không được chọn (kể cả phụ trách chính) không nhận', async () => {
    const customerId = await createCustomer('staffA');
    const appointment = await createAppointment('staffA', customerId, [
      ids.manager1,
    ]);
    queueAdd.mockClear();

    const result = await fireReminder(appointment);
    await runQueuedJobs();

    expect(result).toMatchObject({ sent: 1, canceled: 0 });
    const toManager = await notificationsOf('manager1', appointment.id);
    expect(toManager).toHaveLength(1);
    expect(toManager[0].pushStatus).toBe('SENT');
    expect(sentTo('manager1')).toHaveLength(1);
    for (const key of ['staffA', 'staffB', 'admin', 'manager2']) {
      expect(await notificationsOf(key, appointment.id)).toHaveLength(0);
      expect(sentTo(key)).toHaveLength(0);
    }
  });

  it('người thực hiện bị gỡ khỏi tập hợp lệ trước giờ nhắc: không thông báo, không push; người còn lại vẫn nhận', async () => {
    const customerId = await createCustomer('staffA');
    const add = await call(
      'POST',
      `/crm/customers/${customerId}/care-team/members`,
      'admin',
      { userIds: [ids.staffB] },
    );
    expect(add.status).toBe(201);
    const appointment = await createAppointment('staffA', customerId, [
      ids.staffB,
      ids.staffA,
    ]);
    const removal = await call(
      'DELETE',
      `/crm/customers/${customerId}/care-team/members/${ids.staffB}`,
      'admin',
    );
    expect(removal.status).toBe(200);
    queueAdd.mockClear();

    await fireReminder(appointment);
    await runQueuedJobs();

    expect(await notificationsOf('staffB', appointment.id)).toHaveLength(0);
    expect(sentTo('staffB')).toHaveLength(0);
    expect(await notificationsOf('staffA', appointment.id)).toHaveLength(1);
    expect(sentTo('staffA')).toHaveLength(1);
  });

  it('Admin ngoài tập hợp lệ (ghi thẳng DB) không nhận thông báo lẫn push; hết người nhận thì nhắc bị hủy, không có job push nào', async () => {
    const customerId = await createCustomer('staffA');
    const appointment = await createAppointment('staffA', customerId, [
      ids.staffA,
    ]);
    await col('appointments').updateOne(
      { _id: oid(appointment.id) },
      { $set: { assigneeIds: [oid(ids.admin)] } },
    );
    queueAdd.mockClear();

    const result = await fireReminder(appointment);
    await runQueuedJobs();

    expect(result).toMatchObject({ sent: 0, canceled: 1 });
    expect(queueAdd).not.toHaveBeenCalled();
    for (const key of ['admin', 'staffA']) {
      expect(await notificationsOf(key, appointment.id)).toHaveLength(0);
      expect(sentTo(key)).toHaveLength(0);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('cờ CRM_PUSH_ENABLED tắt: người thực hiện hợp lệ vẫn có thông báo trong ứng dụng (SKIPPED), không có job push.send, không gọi nhà cung cấp; người không được chọn vẫn không nhận', async () => {
    const customerId = await createCustomer('staffA');
    const appointment = await createAppointment('staffA', customerId, [
      ids.manager1,
    ]);
    process.env.CRM_PUSH_ENABLED = 'false';
    queueAdd.mockClear();

    const result = await fireReminder(appointment);
    await runQueuedJobs();

    expect(result).toMatchObject({ sent: 1, canceled: 0 });
    const toManager = await notificationsOf('manager1', appointment.id);
    expect(toManager).toHaveLength(1);
    expect(toManager[0].pushStatus).toBe('SKIPPED');
    expect(toManager[0].push).toBeNull();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    for (const key of ['staffA', 'staffB', 'admin', 'manager2']) {
      expect(await notificationsOf(key, appointment.id)).toHaveLength(0);
    }
  });
});
