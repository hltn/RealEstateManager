/**
 * INTEGRATION — xóa, khôi phục, xóa vĩnh viễn khách "Bỏ" (tài liệu 09 mục 7). HTTP thật (Fastify + guard toàn cục +
 * MongoDB Replica Set in-memory + kho file giả trong bộ nhớ). Kiểm điều unit test mock không chứng minh được:
 * - ma trận quyền xóa đơn và hàng loạt (Admin/Manager/STAFF × khách "Bỏ"/không × trong/ngoài phạm vi × phụ trách chính);
 * - xóa mềm giữ hành vi cũ: audit, SĐT vẫn bị giữ; màn "Khách đã xóa" đủ dữ liệu, không lộ SĐT đầy đủ;
 * - xóa vĩnh viễn: chỉ Admin, chỉ khách đã xóa mềm, dữ liệu con + file biến mất, còn đúng MỘT dòng audit không PII,
 *   SĐT dùng lại được; lỗi kho file không để lại dữ liệu mồ côi (chưa xóa gì ở DB, thử lại được).
 *
 * Các `it` dùng chung dữ liệu và chạy THEO THỨ TỰ. Chạy bằng `npm run test:integration`.
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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import {
  FILE_STORAGE,
  IFileStorage,
} from '../../shared/storage/file-storage.interface';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CustomersRepository } from './customers/customers.repository';
import { PURGE_FILE_CONCURRENCY } from './customers/customer-purge.service';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
interface Res {
  status: number;
  body: any;
}

/** Kho file giả: ghi nhớ object còn lại và cho phép ép lỗi xóa ở một số key (mô phỏng MinIO sập giữa chừng). */
class FakeFileStorage implements IFileStorage {
  readonly objects = new Set<string>();
  readonly failOnDelete = new Set<string>();
  configured = true;
  /** Nếu có: mọi lệnh xóa chờ gate này trước khi xóa thật (mô phỏng MinIO chậm). */
  gate: Promise<void> | null = null;
  readonly deleteCalls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;

  upload(): never {
    throw new Error('không dùng');
  }
  createPresignedUpload(): never {
    throw new Error('không dùng');
  }
  getPresignedDownloadUrl(): Promise<string> {
    return Promise.resolve('https://fake-s3.test/x');
  }
  download(): Promise<Buffer> {
    return Promise.resolve(Buffer.alloc(0));
  }
  /** Mỗi lần gọi nhả một lượt event loop để đếm được số lệnh xóa chạy đồng thời. */
  async delete(_bucket: unknown, key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    if (this.gate) await this.gate;
    this.inFlight -= 1;
    if (this.failOnDelete.has(key)) {
      throw new Error(`MinIO sập khi xóa ${key}`);
    }
    this.objects.delete(key);
  }
  checkHealth(): Promise<void> {
    return Promise.resolve();
  }
  isConfigured(): boolean {
    return this.configured;
  }
}

describe('Xóa / khôi phục / xóa vĩnh viễn khách "Bỏ" — HTTP + MongoDB Replica Set', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  const storage = new FakeFileStorage();

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const status: Record<string, Types.ObjectId> = {};

  const call = async (
    method: Method,
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
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const createUser = async (key: string, ...roles: UserRole[]) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      roles,
      status: UserStatus.ACTIVE,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({
      sub: ids[key],
      email: `${key}@test.vn`,
      role: roles[0],
      roles,
    });
  };

  const col = (name: string) => connection.collection(name);
  const oid = (id: string) => new Types.ObjectId(id);

  let seq = 0;
  /**
   * Tạo khách bằng Admin (người nhập = admin, nên người phụ trách chính KHÔNG phải người nhập) rồi đặt tình trạng.
   * `teamIds` của khách suy ra từ nhóm của các thành viên careTeam.
   */
  const createCustomer = async (
    primary: string,
    members: string[] = [],
    dropped = true,
    extra: Record<string, unknown> = {},
  ) => {
    const phone = `091${String(4_000_000 + ++seq)}`;
    const fullName = `Khách Xóa số ${seq}`;
    const res = await call('POST', '/crm/customers', 'admin', {
      fullName,
      phone,
      email: `kh${seq}@example.com`,
      careTeam: {
        primaryUserId: ids[primary],
        memberIds: members.map((key) => ids[key]),
      },
      ...extra,
    });
    expect([res.status, res.body.message]).toEqual([201, undefined]);
    const id = res.body.data.id as string;
    await col('customers').updateOne(
      { _id: oid(id) },
      { $set: { statusId: dropped ? status.DROPPED : status.INTERESTED } },
    );
    return { id, phone, fullName };
  };

  const del = (as: string, id: string, reason: string | null = 'Khách bỏ') =>
    call(
      'DELETE',
      `/crm/customers/${id}${reason === null ? '' : `?reason=${encodeURIComponent(reason)}`}`,
      as,
    );
  /** Khách "đang xóa vĩnh viễn dở": danh sách báo cờ, khôi phục và ẩn danh hóa đều 409 và không đổi dữ liệu. */
  const expectPurgeBlocksOthers = async (
    id: string,
    purgeInProgress: boolean,
  ) => {
    const list = await call('GET', '/crm/deleted-customers?limit=100', 'admin');
    expect(
      list.body.data.find((row: any) => row.id === id).purgeInProgress,
    ).toBe(purgeInProgress);
    if (!purgeInProgress) return;
    const restore = await call('POST', '/crm/customer-restorations', 'admin', {
      customerId: id,
    });
    expect([restore.status, restore.body.errorCode]).toEqual([
      409,
      'CUSTOMER_PURGE_IN_PROGRESS',
    ]);
    const anonymize = await call(
      'POST',
      '/crm/customer-anonymizations',
      'admin',
      {
        customerId: id,
        reason: 'Yêu cầu khách',
        confirm: true,
      },
    );
    expect([anonymize.status, anonymize.body.errorCode]).toEqual([
      409,
      'CUSTOMER_PURGE_IN_PROGRESS',
    ]);
    const doc = await col('customers').findOne({ _id: oid(id) });
    expect(doc!.deletedAt).not.toBeNull();
    expect(doc!.anonymizedAt ?? null).toBeNull();
  };
  const bulkDelete = (as: string, customerIds: string[], reason?: string) =>
    call('POST', '/crm/customer-bulk-operations', as, {
      type: 'DELETE',
      customerIds,
      payload: reason === undefined ? {} : { reason },
    });
  const isSoftDeleted = async (id: string) =>
    (await col('customers').findOne({ _id: oid(id) }))?.deletedAt != null;
  const auditOf = (customerId: string, action?: string) =>
    col('crm_audit_logs')
      .find({ customerId: oid(customerId), ...(action && { action }) })
      .toArray();

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-delete-${RUN_ID}:`;
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
      .useValue(storage)
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
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();
    for (const group of ['DROPPED', 'INTERESTED']) {
      const row = await col('customer_statuses').findOne({ listGroup: group });
      status[group] = row!._id;
    }

    await createUser('admin', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    // Quản lý KHÔNG thuộc nhóm nào (chỉ quản lý): khách có mặt Quản lý trong careTeam không kéo theo nhóm của họ.
    await createUser('mgrA', UserRole.MANAGER);
    await createUser('mgrB', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffA2', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    // Tài khoản nhiều role (quyền theo role CAO NHẤT trong phân vùng CRM; STAFF+EDITOR giữ quyền STAFF).
    await createUser('mgrStaff', UserRole.MANAGER, UserRole.STAFF);
    await createUser('adminStaff', UserRole.ADMIN, UserRole.STAFF);
    await createUser('staffEditor', UserRole.STAFF, UserRole.EDITOR);

    for (const [key, name, manager] of [
      ['teamA', 'Nhóm A', 'mgrA'],
      ['teamB', 'Nhóm B', 'mgrB'],
    ]) {
      const res = await call('POST', '/teams', 'admin', {
        name,
        code: key.toUpperCase(),
        managerIds: [ids[manager]],
      });
      expect(res.status).toBe(201);
      ids[key] = res.body.data.id;
    }
    for (const [user, team] of [
      ['staffA', 'teamA'],
      ['staffA2', 'teamA'],
      ['staffB', 'teamB'],
    ]) {
      const res = await call('POST', `/teams/${ids[team]}/members`, 'admin', {
        userId: ids[user],
      });
      expect(res.status).toBe(201);
    }
    // 3 tài khoản nhiều role đều thuộc nhóm B; mgrStaff KHÔNG quản lý nhóm nào.
    for (const key of ['mgrStaff', 'adminStaff', 'staffEditor']) {
      await userModel.updateOne(
        { _id: ids[key] },
        { $set: { teamIds: [oid(ids.teamB)], teamId: oid(ids.teamB) } },
      );
    }
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  it('Swagger có route xóa vĩnh viễn và mô tả type DELETE của thao tác hàng loạt', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('qa').addBearerAuth().build(),
    );
    expect(doc.paths['/api/v1/crm/deleted-customers/{id}']).toHaveProperty(
      'delete',
    );
    expect(JSON.stringify(doc.components?.schemas?.BulkOperationDto)).toContain(
      'DELETE',
    );
  });

  // ---------------------------------------------------------------------------------------------
  describe('Xóa đơn DELETE /crm/customers/:id — ma trận quyền', () => {
    it('ADMIN xóa mọi khách (kể cả không "Bỏ" — giữ hành vi cũ); thiếu reason 400; EDITOR 403', async () => {
      const dropped = await createCustomer('staffA');
      const interested = await createCustomer('staffA', [], false);
      expect((await del('admin', dropped.id, null)).status).toBe(400);
      expect((await del('editor', dropped.id)).status).toBe(403);
      expect((await del('admin', dropped.id, 'Nhập nhầm')).status).toBe(204);
      expect((await del('admin', interested.id)).status).toBe(204);
      expect(await isSoftDeleted(dropped.id)).toBe(true);
      expect(await isSoftDeleted(interested.id)).toBe(true);
    });

    it('MANAGER: khách thuộc nhóm mình quản lý xóa được; khách ở nhóm khác 404 (không thấy)', async () => {
      const own = await createCustomer('staffA');
      const other = await createCustomer('staffB');
      expect((await del('mgrA', other.id)).status).toBe(404);
      expect((await del('mgrA', own.id)).status).toBe(204);
      expect(await isSoftDeleted(other.id)).toBe(false);
      const [audit] = await auditOf(own.id, 'CUSTOMER_DELETED');
      expect(audit).toMatchObject({
        reason: 'Khách bỏ',
        actorRole: 'MANAGER',
      });
    });

    it('MANAGER chỉ có mặt trong careTeam của khách nhóm khác: THẤY khách nhưng 403 và không bị xóa; phụ trách chính cũng vậy', async () => {
      const asMember = await createCustomer('staffB', ['mgrA']);
      const asPrimary = await createCustomer('mgrA', ['staffB']);
      for (const customer of [asMember, asPrimary]) {
        // Phạm vi XEM cho phép (không phải 404) nhưng quyền XÓA thì không.
        expect(
          (await call('GET', `/crm/customers/${customer.id}`, 'mgrA')).status,
        ).toBe(200);
        const res = await del('mgrA', customer.id);
        expect([res.status, res.body.errorCode]).toEqual([
          403,
          'INSUFFICIENT_ROLE',
        ]);
        expect(await isSoftDeleted(customer.id)).toBe(false);
      }
    });

    it('MANAGER cũng được xóa khách thuộc nhóm mình quản lý khi mình có mặt trong careTeam (nhóm quản lý vẫn là điều kiện đủ)', async () => {
      const customer = await createCustomer('staffA', ['mgrA']);
      expect((await del('mgrA', customer.id)).status).toBe(204);
    });

    it('STAFF là phụ trách chính nhưng KHÔNG phải người nhập: xóa được khách "Bỏ" (204), có audit, SĐT vẫn bị giữ', async () => {
      const customer = await createCustomer('staffA');
      const doc = await col('customers').findOne({ _id: oid(customer.id) });
      expect(String(doc!.createdBy)).toBe(ids.admin);
      expect((await del('staffA', customer.id, 'Khách từ chối')).status).toBe(
        204,
      );
      expect(await isSoftDeleted(customer.id)).toBe(true);
      const [audit] = await auditOf(customer.id, 'CUSTOMER_DELETED');
      expect(audit).toMatchObject({
        reason: 'Khách từ chối',
        actorId: oid(ids.staffA),
        actorRole: 'STAFF',
      });
      // Xóa mềm vẫn giữ chỗ SĐT.
      const again = await call('POST', '/crm/customers', 'admin', {
        fullName: 'Trùng SĐT',
        phone: customer.phone,
      });
      expect([again.status, again.body.errorCode]).toEqual([
        409,
        'CUSTOMER_PHONE_DUPLICATED',
      ]);
    });

    it('STAFF chỉ là thành viên careTeam (không phải phụ trách chính): 403; không thuộc careTeam: 404', async () => {
      const member = await createCustomer('staffA2', ['staffA']);
      const stranger = await createCustomer('staffB');
      const res = await del('staffA', member.id);
      expect([res.status, res.body.errorCode]).toEqual([
        403,
        'INSUFFICIENT_ROLE',
      ]);
      expect((await del('staffA', stranger.id)).status).toBe(404);
      expect(await isSoftDeleted(member.id)).toBe(false);
      expect(await isSoftDeleted(stranger.id)).toBe(false);
    });

    it('STAFF phụ trách chính nhưng khách KHÔNG "Bỏ": 409 CUSTOMER_NOT_DROPPED, không bị xóa', async () => {
      const customer = await createCustomer('staffA', [], false);
      const res = await del('staffA', customer.id);
      expect([res.status, res.body.errorCode]).toEqual([
        409,
        'CUSTOMER_NOT_DROPPED',
      ]);
      expect(await isSoftDeleted(customer.id)).toBe(false);
    });

    it('FR-11: PRIMARY bị khóa — Quản trị không đổi được phụ trách chính (PUT primary 404), người phụ trách CŨ vẫn có quyền xóa, thành viên phụ không', async () => {
      const customer = await createCustomer('staffA', ['staffA2']);
      const change = await call(
        'PUT',
        `/crm/customers/${customer.id}/care-team/primary`,
        'admin',
        { userId: ids.staffA2 },
      );
      expect(change.status).toBe(404);
      expect((await del('staffA2', customer.id)).status).toBe(403);
      expect((await del('staffA', customer.id)).status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Tài khoản nhiều role (khóa hành vi quyền xóa theo role cao nhất)', () => {
    it('MANAGER+STAFF: coi như Manager — phụ trách chính khách "Bỏ" của nhóm mình KHÔNG quản lý vẫn bị 403 (đơn và hàng loạt); chỉ có careTeam cũng 403', async () => {
      const primary = await createCustomer('mgrStaff');
      const member = await createCustomer('staffB', ['mgrStaff']);
      const single = await del('mgrStaff', primary.id);
      expect([single.status, single.body.errorCode]).toEqual([
        403,
        'INSUFFICIENT_ROLE',
      ]);
      expect((await del('mgrStaff', member.id)).status).toBe(403);
      const bulk = await bulkDelete('mgrStaff', [primary.id, member.id], 'Dọn');
      expect(bulk.body.data.succeeded).toEqual([]);
      expect(bulk.body.data.failed.map((f: any) => f.errorCode)).toEqual([
        'INSUFFICIENT_ROLE',
        'INSUFFICIENT_ROLE',
      ]);
      expect(await isSoftDeleted(primary.id)).toBe(false);
    });

    it('ADMIN+STAFF: quyền Admin — xóa được khách của người khác, kể cả không "Bỏ"', async () => {
      const other = await createCustomer('staffA');
      const interested = await createCustomer('staffB', [], false);
      expect((await del('adminStaff', other.id)).status).toBe(204);
      expect((await del('adminStaff', interested.id)).status).toBe(204);
    });

    it('STAFF+EDITOR: giữ quyền STAFF — phụ trách chính khách "Bỏ" xóa được, chỉ là thành viên thì 403, khách không "Bỏ" 409', async () => {
      const mine = await createCustomer('staffEditor');
      const memberOnly = await createCustomer('staffB', ['staffEditor']);
      const notDropped = await createCustomer('staffEditor', [], false);
      expect((await del('staffEditor', memberOnly.id)).status).toBe(403);
      expect((await del('staffEditor', notDropped.id)).status).toBe(409);
      expect((await del('staffEditor', mine.id)).status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Xóa hàng loạt POST /crm/customer-bulk-operations (type = DELETE)', () => {
    it('payload.reason bắt buộc (400), tối đa 200 khách (201 khách => 400)', async () => {
      const customer = await createCustomer('staffA');
      expect((await bulkDelete('admin', [customer.id])).status).toBe(400);
      // Thiếu HẲN khóa payload (không phải payload rỗng): 400 VALIDATION_FAILED, không phải 500.
      for (const type of ['DELETE', 'ADD_TAGS', 'CHANGE_STATUS']) {
        const res = await call(
          'POST',
          '/crm/customer-bulk-operations',
          'admin',
          {
            type,
            customerIds: [customer.id],
          },
        );
        expect([type, res.status, res.body.errorCode]).toEqual([
          type,
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect((await bulkDelete('admin', [customer.id], '   ')).status).toBe(
        400,
      );
      const many = Array.from({ length: 201 }, () =>
        String(new Types.ObjectId()),
      );
      expect((await bulkDelete('admin', many, 'x')).status).toBe(400);
      expect(await isSoftDeleted(customer.id)).toBe(false);
      // Đúng 200 khách (id không tồn tại) được nhận và báo lỗi từng khách.
      const edge = await bulkDelete('admin', many.slice(0, 200), 'x');
      expect(edge.status).toBe(200);
      expect(edge.body.data.failed).toHaveLength(200);
    });

    it('reason chỉ gồm ký tự vô hình (zero-width, nhóm Cf) bị 400 ở cả xóa đơn lẫn hàng loạt; có chữ lẫn ký tự vô hình thì chấp nhận', async () => {
      const customer = await createCustomer('staffA');
      // Ký tự trống giả dạng (Hangul filler, Braille blank, dấu kết hợp đơn độc) và ký tự điều khiển cũng không tính là chữ.
      for (const invisible of [
        '\u200B',
        ' \u2060\uFEFF ',
        '\u3164',
        '\u2800\u034F\uFE0F',
        '\u0007',
      ]) {
        expect((await del('admin', customer.id, invisible)).status).toBe(400);
        expect(
          (await bulkDelete('admin', [customer.id], invisible)).status,
        ).toBe(400);
      }
      expect(await isSoftDeleted(customer.id)).toBe(false);
      expect((await del('admin', customer.id, 'a\u200Bb')).status).toBe(204);
    });

    it('MANAGER lẫn khách lỗi quyền: khách hợp lệ vẫn xóa; mỗi khách báo đúng mã lỗi; khách lỗi không bị đụng', async () => {
      const ok1 = await createCustomer('staffA');
      const ok2 = await createCustomer('staffA2', ['mgrA']);
      const outside = await createCustomer('staffB'); // ngoài phạm vi xem
      const careTeamOnly = await createCustomer('staffB', ['mgrA']); // thấy nhưng không quản lý nhóm
      const notDropped = await createCustomer('staffA', [], false);
      const ghost = String(new Types.ObjectId());

      const res = await bulkDelete(
        'mgrA',
        [ok1.id, outside.id, careTeamOnly.id, ok2.id, notDropped.id, ghost],
        'Dọn khách bỏ',
      );
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded.sort()).toEqual([ok1.id, ok2.id].sort());
      const failed = Object.fromEntries(
        res.body.data.failed.map((f: any) => [f.customerId, f.errorCode]),
      );
      expect(failed).toEqual({
        [outside.id]: 'CUSTOMER_NOT_FOUND',
        [careTeamOnly.id]: 'INSUFFICIENT_ROLE',
        [notDropped.id]: 'CUSTOMER_NOT_DROPPED',
        [ghost]: 'CUSTOMER_NOT_FOUND',
      });
      expect(await isSoftDeleted(ok1.id)).toBe(true);
      expect(await isSoftDeleted(ok2.id)).toBe(true);
      for (const kept of [outside, careTeamOnly, notDropped]) {
        expect(await isSoftDeleted(kept.id)).toBe(false);
        expect(await auditOf(kept.id, 'CUSTOMER_DELETED')).toHaveLength(0);
      }
      // Cùng một lý do chung, mỗi khách một audit.
      expect(await auditOf(ok1.id, 'CUSTOMER_DELETED')).toHaveLength(1);
      const [audit] = await auditOf(ok2.id, 'CUSTOMER_DELETED');
      expect(audit).toMatchObject({
        reason: 'Dọn khách bỏ',
        actorRole: 'MANAGER',
      });
    });

    it('STAFF: chỉ khách "Bỏ" mình là phụ trách chính; thành viên thường và khách không "Bỏ" bị từ chối từng khách', async () => {
      const mine = await createCustomer('staffA');
      const memberOnly = await createCustomer('staffA2', ['staffA']);
      const mineNotDropped = await createCustomer('staffA', [], false);
      const res = await bulkDelete(
        'staffA',
        [mine.id, memberOnly.id, mineNotDropped.id],
        'Dọn',
      );
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual([mine.id]);
      expect(
        Object.fromEntries(
          res.body.data.failed.map((f: any) => [f.customerId, f.errorCode]),
        ),
      ).toEqual({
        [memberOnly.id]: 'INSUFFICIENT_ROLE',
        [mineNotDropped.id]: 'CUSTOMER_NOT_DROPPED',
      });
    });

    it('ADMIN: khách không "Bỏ" bị từ chối CUSTOMER_NOT_DROPPED (hàng loạt đòi "Bỏ" cho mọi vai); EDITOR 403', async () => {
      const dropped = await createCustomer('staffA');
      const interested = await createCustomer('staffA', [], false);
      const res = await bulkDelete('admin', [dropped.id, interested.id], 'Dọn');
      expect(res.body.data.succeeded).toEqual([dropped.id]);
      expect(res.body.data.failed).toEqual([
        { customerId: interested.id, errorCode: 'CUSTOMER_NOT_DROPPED' },
      ]);
      expect((await bulkDelete('editor', [dropped.id], 'x')).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Khách đã xóa: danh sách và khôi phục (Admin)', () => {
    it('GET /crm/deleted-customers: chỉ Admin; có id, tên, ngày xóa, lý do xóa, người xóa; không lộ SĐT đầy đủ/email', async () => {
      const customer = await createCustomer('staffA');
      expect((await del('mgrA', customer.id, 'Trùng khách cũ')).status).toBe(
        204,
      );

      for (const as of ['mgrA', 'staffA', 'editor']) {
        expect((await call('GET', '/crm/deleted-customers', as)).status).toBe(
          403,
        );
      }
      const res = await call(
        'GET',
        `/crm/deleted-customers?q=${encodeURIComponent(customer.fullName)}`,
        'admin',
      );
      expect(res.status).toBe(200);
      const item = res.body.data.find((row: any) => row.id === customer.id);
      expect(item).toMatchObject({
        fullName: customer.fullName,
        deleteReason: 'Trùng khách cũ',
        deletedBy: { id: ids.mgrA, displayName: 'mgrA' },
        anonymizedAt: null,
      });
      expect(new Date(item.deletedAt).getTime()).not.toBeNaN();
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(customer.phone);
      expect(json).not.toContain('@example.com');
    });

    it('khôi phục POST /crm/customer-restorations: Admin 201, khách xem lại được, lần xóa sau lấy lý do MỚI NHẤT; Manager 403', async () => {
      const customer = await createCustomer('staffA');
      await del('admin', customer.id, 'Lần một');
      expect(
        (
          await call('POST', '/crm/customer-restorations', 'mgrA', {
            customerId: customer.id,
          })
        ).status,
      ).toBe(403);
      const restored = await call(
        'POST',
        '/crm/customer-restorations',
        'admin',
        {
          customerId: customer.id,
        },
      );
      expect(restored.status).toBe(201);
      expect(restored.body.data.id).toBe(customer.id);
      expect(
        (await call('GET', `/crm/customers/${customer.id}`, 'staffA')).status,
      ).toBe(200);
      await del('admin', customer.id, 'Lần hai');
      const list = await call(
        'GET',
        `/crm/deleted-customers?q=${encodeURIComponent(customer.fullName)}`,
        'admin',
      );
      expect(
        list.body.data.find((row: any) => row.id === customer.id).deleteReason,
      ).toBe('Lần hai');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Xóa vĩnh viễn DELETE /crm/deleted-customers/:id', () => {
    let tagId: string;
    let target: { id: string; phone: string; fullName: string };
    let bystander: { id: string };
    let bystanderAuditCount: number;
    const fileKeys = ['purge/a.jpg', 'purge/b.jpg', 'purge/c.jpg'];

    /** Dựng một khách đầy đủ dữ liệu con (nhật ký, ảnh, lịch hẹn + nhắc, yêu cầu nhóm, thông báo, thẻ). */
    beforeAll(async () => {
      const tag = await call('POST', '/crm/tags', 'admin', {
        name: `Thẻ purge ${RUN_ID}`,
        category: 'OTHER',
      });
      expect(tag.status).toBe(201);
      tagId = tag.body.data.id;

      target = await createCustomer('staffA', ['staffA2'], true, {
        tagIds: [tagId],
      });
      bystander = await createCustomer('staffA');
      await call('POST', `/crm/customers/${bystander.id}/care-logs`, 'staffA', {
        content: 'Nhật ký của khách khác',
        contactChannel: 'CALL',
      });
      bystanderAuditCount = (await auditOf(bystander.id)).length;

      const log = await call(
        'POST',
        `/crm/customers/${target.id}/care-logs`,
        'staffA',
        {
          content: 'Khách Nguyễn Văn Purge hẹn xem nhà',
          contactChannel: 'CALL',
        },
      );
      expect([log.status, log.body.message]).toEqual([201, undefined]);
      const appointment = await call('POST', '/crm/appointments', 'staffA', {
        customerId: target.id,
        type: 'SITE_VISIT',
        startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      });
      expect([appointment.status, appointment.body.message]).toEqual([
        201,
        undefined,
      ]);

      for (const [index, fileKey] of fileKeys.entries()) {
        if (index < 2) storage.objects.add(fileKey);
        await col('crm_attachments').insertOne({
          customerId: oid(target.id),
          careLogId: oid(log.body.data.id),
          uploaderId: oid(ids.staffA),
          kind: 'CARE_LOG_IMAGE',
          fileKey,
          // Ảnh a có thumbnail riêng; ảnh c đã được job dọn xóa file từ trước (purgedAt) nên không được xóa lại.
          thumbKey: index === 0 ? 'purge/a-thumb.jpg' : null,
          originalName: 'anh.jpg',
          mimeType: 'image/jpeg',
          size: 10,
          status: index === 2 ? 'REMOVED' : 'ATTACHED',
          purgedAt: index === 2 ? new Date() : null,
          createdAt: new Date(),
        });
      }
      storage.objects.add('purge/a-thumb.jpg');
      await col('care_team_requests').insertOne({
        customerId: oid(target.id),
        requesterId: oid(ids.staffB),
        message: 'Cho tôi tham gia chăm khách Nguyễn Văn Purge',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await col('notifications').insertOne({
        userId: oid(ids.staffA),
        type: 'APPOINTMENT_DUE',
        title: 'Nhắc hẹn Nguyễn Văn Purge',
        body: 'Sắp đến giờ hẹn',
        data: { customerId: oid(target.id) },
        createdAt: new Date(),
      });
      await del('admin', target.id, 'Xóa để purge');
    });

    it('chỉ ADMIN: Manager/STAFF/EDITOR 403, chưa đăng nhập 401; dữ liệu không đổi', async () => {
      for (const as of ['mgrA', 'staffA', 'editor']) {
        expect(
          (await call('DELETE', `/crm/deleted-customers/${target.id}`, as))
            .status,
        ).toBe(403);
      }
      const anon = await app.inject({
        method: 'DELETE',
        url: `/api/v1/crm/deleted-customers/${target.id}`,
      });
      expect(anon.statusCode).toBe(401);
      expect(
        await col('customers').countDocuments({ _id: oid(target.id) }),
      ).toBe(1);
      expect(
        await col('care_logs').countDocuments({ customerId: oid(target.id) }),
      ).toBe(1);
    });

    it('id sai 400, không tồn tại 404; khách CHƯA xóa mềm 409 CUSTOMER_NOT_DELETED và không bị đụng', async () => {
      expect(
        (await call('DELETE', '/crm/deleted-customers/not-an-id', 'admin'))
          .status,
      ).toBe(400);
      expect(
        (
          await call(
            'DELETE',
            `/crm/deleted-customers/${String(new Types.ObjectId())}`,
            'admin',
          )
        ).status,
      ).toBe(404);
      const live = await createCustomer('staffA');
      await call('POST', `/crm/customers/${live.id}/care-logs`, 'staffA', {
        content: 'x',
        contactChannel: 'CALL',
      });
      const res = await call(
        'DELETE',
        `/crm/deleted-customers/${live.id}`,
        'admin',
      );
      expect([res.status, res.body.errorCode]).toEqual([
        409,
        'CUSTOMER_NOT_DELETED',
      ]);
      expect(await col('customers').countDocuments({ _id: oid(live.id) })).toBe(
        1,
      );
      expect(
        await col('care_logs').countDocuments({ customerId: oid(live.id) }),
      ).toBe(1);
    });

    it('MinIO lỗi giữa chừng: 503, CHƯA xóa dòng DB nào (không mồ côi vô hình); file đã xóa được ghi nhận để lần thử lại bỏ qua', async () => {
      storage.failOnDelete.add('purge/b.jpg');
      const res = await call(
        'DELETE',
        `/crm/deleted-customers/${target.id}`,
        'admin',
      );
      expect([res.status, res.body.errorCode]).toEqual([
        503,
        'SERVICE_UNAVAILABLE',
      ]);

      expect(
        await col('customers').countDocuments({ _id: oid(target.id) }),
      ).toBe(1);
      expect(
        await col('care_logs').countDocuments({ customerId: oid(target.id) }),
      ).toBe(1);
      expect(
        await col('crm_attachments').countDocuments({
          customerId: oid(target.id),
        }),
      ).toBe(3);
      expect(
        await col('appointments').countDocuments({
          customerId: oid(target.id),
        }),
      ).toBe(1);
      expect(await auditOf(target.id, 'CUSTOMER_PURGED')).toHaveLength(0);
      // Ảnh a (xong) đã ghi purgedAt; ảnh b (lỗi) vẫn còn file và chưa purgedAt.
      const attachments = await col('crm_attachments')
        .find({ customerId: oid(target.id) })
        .toArray();
      const byKey = Object.fromEntries(attachments.map((a) => [a.fileKey, a]));
      expect(byKey['purge/a.jpg'].purgedAt).not.toBeNull();
      expect(byKey['purge/b.jpg'].purgedAt).toBeNull();
      expect(storage.objects.has('purge/b.jpg')).toBe(true);
      // Khách ở trạng thái "đang xóa dở": cờ hiện ở danh sách, khôi phục/ẩn danh hóa bị chặn.
      await expectPurgeBlocksOthers(target.id, true);
    });

    it('kho file lỗi ở file ĐẦU: dừng sớm (không gọi tuần tự hết các file sau), xóa song song có giới hạn, thử lại xong thì chạy nốt', async () => {
      const customer = await createCustomer('staffA');
      await del('admin', customer.id, 'Dọn nhiều ảnh');
      const total = 30;
      const keys = Array.from({ length: total }, (_, i) => `many/${i}.jpg`);
      await col('crm_attachments').insertMany(
        keys.map((fileKey) => ({
          customerId: oid(customer.id),
          uploaderId: oid(ids.staffA),
          kind: 'CARE_LOG_IMAGE',
          fileKey,
          thumbKey: null,
          originalName: 'a.jpg',
          mimeType: 'image/jpeg',
          size: 1,
          status: 'READY',
          purgedAt: null,
          createdAt: new Date(),
        })),
      );
      keys.forEach((key) => storage.objects.add(key));
      storage.failOnDelete.clear();
      // Kho hỏng hoàn toàn (mọi lệnh xóa đều lỗi): không phụ thuộc thứ tự đọc ảnh, chỉ các lệnh đã chạy lúc phát hiện lỗi được gọi.
      keys.forEach((key) => storage.failOnDelete.add(key));
      storage.deleteCalls.length = 0;
      storage.maxInFlight = 0;

      const failed = await call(
        'DELETE',
        `/crm/deleted-customers/${customer.id}`,
        'admin',
      );
      expect([failed.status, failed.body.errorCode]).toEqual([
        503,
        'SERVICE_UNAVAILABLE',
      ]);
      // Chỉ các lệnh đang chạy lúc lỗi (≤ số worker) được gọi; 30 file không bị gọi hết.
      expect(storage.deleteCalls.length).toBeLessThanOrEqual(
        PURGE_FILE_CONCURRENCY,
      );
      expect(storage.maxInFlight).toBeLessThanOrEqual(PURGE_FILE_CONCURRENCY);
      expect(
        await col('customers').countDocuments({ _id: oid(customer.id) }),
      ).toBe(1);
      // Không ảnh nào xóa xong nên không ảnh nào được ghi purgedAt.
      const doneBeforeRetry = await col('crm_attachments').countDocuments({
        customerId: oid(customer.id),
        purgedAt: { $ne: null },
      });
      storage.failOnDelete.clear();
      storage.deleteCalls.length = 0;
      storage.maxInFlight = 0;
      const retry = await call(
        'DELETE',
        `/crm/deleted-customers/${customer.id}`,
        'admin',
      );
      expect(retry.status).toBe(200);
      expect(retry.body.data.purged.attachments).toBe(total);
      // Lần thử lại chỉ xóa file chưa purgedAt (không làm lại file đã xong) và chạy SONG SONG, có giới hạn.
      expect(doneBeforeRetry).toBe(0);
      expect(storage.deleteCalls).toHaveLength(total);
      expect(storage.maxInFlight).toBeGreaterThan(1);
      expect(storage.maxInFlight).toBeLessThanOrEqual(PURGE_FILE_CONCURRENCY);
      expect(
        [...storage.objects].filter((key) => key.startsWith('many/')),
      ).toEqual([]);
    });

    it('kho file chưa cấu hình mà còn file cần xóa: 503 và không xóa gì ở DB', async () => {
      storage.failOnDelete.clear();
      storage.configured = false;
      const res = await call(
        'DELETE',
        `/crm/deleted-customers/${target.id}`,
        'admin',
      );
      storage.configured = true;
      expect([res.status, res.body.errorCode]).toEqual([
        503,
        'SERVICE_UNAVAILABLE',
      ]);
      expect(
        await col('customers').countDocuments({ _id: oid(target.id) }),
      ).toBe(1);
    });

    it('thử lại thành công: 200 kèm số lượng đã xóa; dữ liệu con, file, thông báo, nhắc biến mất; khách khác nguyên vẹn', async () => {
      const res = await call(
        'DELETE',
        `/crm/deleted-customers/${target.id}`,
        'admin',
      );
      expect([res.status, res.body.message]).toEqual([200, undefined]);
      expect(res.body.data).toMatchObject({
        customerId: target.id,
        purged: {
          careLogs: 1,
          attachments: 3,
          appointments: 1,
          careTeamRequests: 1,
        },
      });
      // Lần trước đã xóa a (+thumb) và ghi purgedAt; c đã purge từ trước; lần này chỉ còn đúng file b.
      expect(res.body.data.purged.files).toBe(1);
      // Thông báo thật do hệ thống sinh (giao khách, nhật ký, lịch hẹn) cộng thông báo dựng tay: xóa hết.
      expect(res.body.data.purged.notifications).toBeGreaterThanOrEqual(1);
      expect(res.body.data.purged.reminders).toBeGreaterThanOrEqual(1);
      expect(res.body.data.purged.auditLogs).toBeGreaterThanOrEqual(4);

      const mine = { customerId: oid(target.id) };
      expect(
        await col('customers').countDocuments({ _id: oid(target.id) }),
      ).toBe(0);
      for (const name of [
        'care_logs',
        'crm_attachments',
        'appointments',
        'care_team_requests',
        'reminders',
      ]) {
        expect([name, await col(name).countDocuments(mine)]).toEqual([name, 0]);
      }
      expect(
        await col('notifications').countDocuments({
          'data.customerId': oid(target.id),
        }),
      ).toBe(0);
      expect(
        [...storage.objects].filter((key) => key.startsWith('purge/')),
      ).toEqual([]);

      // Khách khác và dữ liệu của họ không bị đụng.
      expect(
        await col('customers').countDocuments({ _id: oid(bystander.id) }),
      ).toBe(1);
      expect(
        await col('care_logs').countDocuments({
          customerId: oid(bystander.id),
        }),
      ).toBe(1);
      expect((await auditOf(bystander.id)).length).toBe(bystanderAuditCount);
      // Thẻ trả lại usageCount.
      expect((await col('tags').findOne({ _id: oid(tagId) }))!.usageCount).toBe(
        0,
      );
    });

    it('còn ĐÚNG MỘT dòng audit của khách, không chứa PII (tên, SĐT, email, nội dung nhật ký, lý do xóa)', async () => {
      const rows = await auditOf(target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'CUSTOMER_PURGED',
        entityType: 'CUSTOMER',
        actorId: oid(ids.admin),
        reason: null,
      });
      const everything = JSON.stringify(
        await col('crm_audit_logs').find({}).toArray(),
      );
      for (const pii of [
        target.phone,
        target.fullName,
        'Nguyễn Văn Purge',
        'Xóa để purge',
      ]) {
        expect(everything).not.toContain(pii);
      }
      // Dòng audit không rò email của khách (khách tạo với email kh<N>@example.com).
      expect(JSON.stringify(rows[0])).not.toContain('@example.com');
    });

    it('khách đã bị xóa vĩnh viễn: xóa lại 404; không còn trong danh sách đã xóa; SĐT dùng lại được (tạo khách mới cùng SĐT 201)', async () => {
      expect(
        (await call('DELETE', `/crm/deleted-customers/${target.id}`, 'admin'))
          .status,
      ).toBe(404);
      const list = await call(
        'GET',
        '/crm/deleted-customers?limit=100',
        'admin',
      );
      expect(list.body.data.map((row: any) => row.id)).not.toContain(target.id);
      expect(
        (
          await call('POST', '/crm/customer-restorations', 'admin', {
            customerId: target.id,
          })
        ).status,
      ).toBe(404);

      const reuse = await call('POST', '/crm/customers', 'admin', {
        fullName: 'Khách dùng lại SĐT',
        phone: target.phone,
      });
      expect([reuse.status, reuse.body.message]).toEqual([201, undefined]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Xóa vĩnh viễn đã bắt đầu thì không khôi phục / ẩn danh hóa / xóa song song (cờ purgingAt)', () => {
    const makeDeletedWithFiles = async (prefix: string, count = 2) => {
      const customer = await createCustomer('staffA');
      await del('admin', customer.id, 'Chuẩn bị xóa vĩnh viễn');
      const keys = Array.from(
        { length: count },
        (_, i) => `${prefix}/${i}.jpg`,
      );
      await col('crm_attachments').insertMany(
        keys.map((fileKey) => ({
          customerId: oid(customer.id),
          uploaderId: oid(ids.staffA),
          kind: 'CARE_LOG_IMAGE',
          fileKey,
          thumbKey: null,
          originalName: 'a.jpg',
          mimeType: 'image/jpeg',
          size: 1,
          status: 'READY',
          purgedAt: null,
          createdAt: new Date(),
        })),
      );
      keys.forEach((key) => storage.objects.add(key));
      return { ...customer, keys };
    };

    it('khách xóa mềm bình thường: purgeInProgress=false và khôi phục vẫn chạy', async () => {
      const customer = await createCustomer('staffA');
      await del('admin', customer.id);
      await expectPurgeBlocksOthers(customer.id, false);
      expect(
        (
          await call('POST', '/crm/customer-restorations', 'admin', {
            customerId: customer.id,
          })
        ).status,
      ).toBe(201);
    });

    it('MinIO chậm: trong lúc purge đang chạy, khôi phục/ẩn danh hóa/purge thứ hai đều 409 CUSTOMER_PURGE_IN_PROGRESS; ảnh và file nguyên; xong thì 200', async () => {
      const customer = await makeDeletedWithFiles('slow');
      let release!: () => void;
      storage.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      storage.deleteCalls.length = 0;
      try {
        const pending = call(
          'DELETE',
          `/crm/deleted-customers/${customer.id}`,
          'admin',
        );
        // Chờ purge đã đặt cờ và bắt đầu gọi xóa file.
        for (let i = 0; i < 100 && storage.deleteCalls.length === 0; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(storage.deleteCalls.length).toBeGreaterThan(0);

        await expectPurgeBlocksOthers(customer.id, true);
        const second = await call(
          'DELETE',
          `/crm/deleted-customers/${customer.id}`,
          'admin',
        );
        expect([second.status, second.body.errorCode]).toEqual([
          409,
          'CUSTOMER_PURGE_IN_PROGRESS',
        ]);
        // Dữ liệu và file còn nguyên trong lúc chờ.
        expect(
          await col('crm_attachments').countDocuments({
            customerId: oid(customer.id),
          }),
        ).toBe(2);
        expect(customer.keys.every((key) => storage.objects.has(key))).toBe(
          true,
        );

        release();
        const done = await pending;
        expect([done.status, done.body.message]).toEqual([200, undefined]);
      } finally {
        release();
        storage.gate = null;
      }
      expect(
        await col('customers').countDocuments({ _id: oid(customer.id) }),
      ).toBe(0);
      expect(customer.keys.some((key) => storage.objects.has(key))).toBe(false);
    });

    it('sau lỗi 503: khôi phục/ẩn danh hóa bị 409, purge lại NGAY được và hoàn tất', async () => {
      const customer = await makeDeletedWithFiles('retry');
      storage.failOnDelete.add(customer.keys[0]);
      const failed = await call(
        'DELETE',
        `/crm/deleted-customers/${customer.id}`,
        'admin',
      );
      storage.failOnDelete.clear();
      expect(failed.status).toBe(503);
      await expectPurgeBlocksOthers(customer.id, true);
      const retry = await call(
        'DELETE',
        `/crm/deleted-customers/${customer.id}`,
        'admin',
      );
      expect([retry.status, retry.body.message]).toEqual([200, undefined]);
      expect(
        await col('customers').countDocuments({ _id: oid(customer.id) }),
      ).toBe(0);
    });

    it('bộ lọc ghi purgingAt: null chặn một mình (đọc bị bỏ qua cờ): khôi phục và ẩn danh hóa vẫn 409, ẩn danh hóa rollback sạch', async () => {
      const customer = await createCustomer('staffA');
      const log = await call(
        'POST',
        `/crm/customers/${customer.id}/care-logs`,
        'staffA',
        { content: 'Nội dung nhật ký cần giữ nguyên', contactChannel: 'CALL' },
      );
      expect(log.status).toBe(201);
      await del('admin', customer.id, 'Chờ purge');
      // Mô phỏng purge kịp đặt cờ NGAY SAU lúc restore/anonymize đã đọc khách: cho lần đọc thấy như chưa có cờ.
      await col('customers').updateOne(
        { _id: oid(customer.id) },
        { $set: { purgingAt: new Date() } },
      );
      const repo = app.get(CustomersRepository);
      const realFindOne = repo.findOne.bind(repo);
      const spy = jest
        .spyOn(repo, 'findOne')
        .mockImplementation(async (...args) => {
          const row = await realFindOne(...args);
          if (row) delete (row as { purgingAt?: unknown }).purgingAt;
          return row;
        });
      try {
        const restore = await call(
          'POST',
          '/crm/customer-restorations',
          'admin',
          {
            customerId: customer.id,
          },
        );
        expect([restore.status, restore.body.errorCode]).toEqual([
          409,
          'CUSTOMER_PURGE_IN_PROGRESS',
        ]);
        const anonymize = await call(
          'POST',
          '/crm/customer-anonymizations',
          'admin',
          {
            customerId: customer.id,
            reason: 'Yêu cầu khách',
            confirm: true,
          },
        );
        expect([anonymize.status, anonymize.body.errorCode]).toEqual([
          409,
          'CUSTOMER_PURGE_IN_PROGRESS',
        ]);
      } finally {
        spy.mockRestore();
      }
      // Rollback sạch: khách, nhật ký và audit nguyên vẹn, không có audit ẩn danh/khôi phục.
      const doc = await col('customers').findOne({ _id: oid(customer.id) });
      expect(doc!.fullName).toBe(customer.fullName);
      expect(doc!.deletedAt).not.toBeNull();
      expect(doc!.anonymizedAt ?? null).toBeNull();
      expect(
        (await col('care_logs').findOne({ customerId: oid(customer.id) }))!
          .content,
      ).toBe('Nội dung nhật ký cần giữ nguyên');
      expect(await auditOf(customer.id, 'CUSTOMER_ANONYMIZED')).toHaveLength(0);
      expect(await auditOf(customer.id, 'CUSTOMER_RESTORED')).toHaveLength(0);
      const created = (await auditOf(customer.id, 'CUSTOMER_CREATED'))[0];
      expect(JSON.stringify(created.changes)).toContain(customer.fullName);
    });

    it('purge chạy quá 15 giây bị claim lần hai (lùi purgingAt 20 giây): một bên 200, bên kia 404; file xóa hết; đúng một audit CUSTOMER_PURGED', async () => {
      const customer = await makeDeletedWithFiles('overlap');
      let release!: () => void;
      storage.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      storage.deleteCalls.length = 0;
      try {
        const first = call(
          'DELETE',
          `/crm/deleted-customers/${customer.id}`,
          'admin',
        );
        for (let i = 0; i < 100 && storage.deleteCalls.length === 0; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(storage.deleteCalls.length).toBeGreaterThan(0);
        // Cờ của lần đầu đã "quá 15 giây": lần hai được phép claim.
        await col('customers').updateOne(
          { _id: oid(customer.id) },
          { $set: { purgingAt: new Date(Date.now() - 20_000) } },
        );
        const second = call(
          'DELETE',
          `/crm/deleted-customers/${customer.id}`,
          'admin',
        );
        // Chờ lần hai cũng vào bước xóa file (cả hai cùng kẹt ở gate).
        const callsBeforeSecond = storage.deleteCalls.length;
        for (
          let i = 0;
          i < 100 && storage.deleteCalls.length === callsBeforeSecond;
          i += 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        release();
        const statuses = [(await first).status, (await second).status].sort();
        expect(statuses).toEqual([200, 404]);
      } finally {
        release();
        storage.gate = null;
      }
      expect(
        await col('customers').countDocuments({ _id: oid(customer.id) }),
      ).toBe(0);
      expect(customer.keys.some((key) => storage.objects.has(key))).toBe(false);
      expect(await auditOf(customer.id)).toHaveLength(1);
      expect(await auditOf(customer.id, 'CUSTOMER_PURGED')).toHaveLength(1);
    });

    it('khách chưa xóa mềm vẫn 409 CUSTOMER_NOT_DELETED và KHÔNG bị đặt cờ purgingAt', async () => {
      const live = await createCustomer('staffA');
      const res = await call(
        'DELETE',
        `/crm/deleted-customers/${live.id}`,
        'admin',
      );
      expect([res.status, res.body.errorCode]).toEqual([
        409,
        'CUSTOMER_NOT_DELETED',
      ]);
      const doc = await col('customers').findOne({ _id: oid(live.id) });
      expect(doc!.purgingAt ?? null).toBeNull();
    });
  });
});
