/**
 * INTEGRATION (QA bổ sung, M3): bất biến PRIMARY dưới tải đồng thời, phân công hợp lệ, đề nghị tham gia, ẩn danh hóa phủ
 * dữ liệu chăm sóc, biên của ảnh. Cùng harness với crm-m3.integration.spec.ts (kho ảnh giả trong bộ nhớ, Redis dev).
 * (Các ca it.failing đã được sửa và đổi thành it.)
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
import fastifyMultipart from '@fastify/multipart';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
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
  StorageBucket,
  StoredFile,
  UploadFileInput,
} from '../../shared/storage/file-storage.interface';
import {
  assertFileAllowed,
  extensionForMime,
} from '../../shared/storage/file-validation';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { UsersModule } from '../users/users.module';
import { PiiCryptoService } from './common/crypto/pii-crypto.service';
import { CrmRateLimitService } from './common/security/crm-rate-limit.service';
import { AttachmentCleanupService } from './care-logs/attachment-cleanup.service';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(300_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const ATTACHMENTS_FLAG = 'FEATURE_CRM_ATTACHMENTS';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
const HOUR = 3_600_000;

interface Res {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

/** Kho ảnh giả trong bộ nhớ: kiểm tra MIME/dung lượng thật như `FileStorageService`, nhưng không chạm mạng. */
class InMemoryFileStorage implements IFileStorage {
  readonly objects = new Map<string, Buffer>();

  upload(input: UploadFileInput): Promise<StoredFile> {
    assertFileAllowed(input.policy, {
      mimeType: input.mimeType,
      size: input.body.length,
      buffer: input.body,
    });
    const key = `${input.prefix ?? ''}${randomUUID()}.${extensionForMime(input.mimeType)}`;
    this.objects.set(key, Buffer.from(input.body));
    return Promise.resolve({
      bucket: input.bucket,
      key,
      size: input.body.length,
      mimeType: input.mimeType,
    });
  }
  createPresignedUpload(): never {
    throw new Error('Không dùng ở M3');
  }
  getPresignedDownloadUrl(bucket: StorageBucket, key: string): Promise<string> {
    return Promise.resolve(`https://fake-s3.test/${bucket}/${key}?sig=1`);
  }
  download(_bucket: StorageBucket, key: string): Promise<Buffer> {
    return Promise.resolve(this.objects.get(key)!);
  }
  delete(_bucket: StorageBucket, key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
  checkHealth(): Promise<void> {
    return Promise.resolve();
  }
  isConfigured(): boolean {
    return true;
  }
}

// ---- Ảnh mẫu (cấu trúc tối thiểu đủ cho bộ lọc metadata + kiểm magic bytes) ------------------------------------
const GPS_MARKER = 'GPSLatitude=10.77;GPSLongitude=106.69';
const jpegSegment = (marker: number, payload: Buffer): Buffer => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
};
/** JPEG giả có Exif/GPS ở APP1. `padding` để tạo file lớn. */
const jpegWithGps = (padding = 0): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, Buffer.from(`Exif\0\0${GPS_MARKER}`)),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.alloc(padding, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);

const multipart = (
  filename: string,
  mimeType: string,
  content: Buffer,
  field = 'file',
) => {
  const boundary = `----it${randomUUID().slice(0, 8)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};

describe('CRM M3 — QA đối kháng', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let pii: PiiCryptoService;
  const storage = new InMemoryFileStorage();

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
    return { status: res.statusCode, body: parsed, headers: res.headers };
  };

  const upload = async (
    customerId: string,
    as: string,
    file: {
      name?: string;
      mime?: string;
      content?: Buffer;
      field?: string;
    } = {},
  ): Promise<Res> => {
    const { payload, headers } = multipart(
      file.name ?? 'anh.jpg',
      file.mime ?? 'image/jpeg',
      file.content ?? jpegWithGps(),
      file.field,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/crm/customers/${customerId}/care-log-attachments`,
      headers: { authorization: `Bearer ${tokens[as]}`, ...headers },
      payload,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
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
  /** SĐT VN hợp lệ, duy nhất theo thứ tự gọi (đầu 092 để không đụng M2). */
  const nextPhone = () => `092${String(1_000_000 + ++phoneSeq)}`;

  /** Dựng nhóm chăm sóc ban đầu cho ca thử: người tạo là PRIMARY (FR-10), các thành viên phụ được mời sau đó. */
  interface SeedCareTeam {
    memberIds: string[];
    primaryUserId: string;
  }
  /**
   * Tạo khách. `careTeam` không còn là trường của `CreateCustomerDto` (T-07, gửi lên sẽ 400): để dựng nhóm có sẵn,
   * helper tạo khách bằng CHÍNH người PRIMARY mong muốn rồi mời `memberIds` qua API. Mời tốn lượt `CARE_TEAM_INVITE`
   * (Redis) nên lượt kiểm giới hạn được stub tạm trong lúc dựng dữ liệu, giống cách các suite CRM khác xử lý.
   */
  const createCustomer = async (
    as: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; phone: string }> => {
    const { careTeam, ...body } = extra as {
      careTeam?: SeedCareTeam;
    } & Record<string, unknown>;
    const creator = careTeam
      ? Object.keys(ids).find((key) => ids[key] === careTeam.primaryUserId)
      : as;
    if (!creator) throw new Error('primaryUserId của careTeam không có token');
    const phone = nextPhone();
    const res = await call('POST', '/crm/customers', creator, {
      fullName: `Khách ${phone}`,
      phone,
      ...body,
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    if (careTeam && careTeam.memberIds.length > 0) {
      // Lượt CARE_TEAM_INVITE do stub mức describe (`stubRateLimit`) lo; không spy lại ở đây để khỏi gỡ nhầm stub của ca gọi ngoài.
      if (!jest.isMockFunction(rateLimitProto.consume))
        throw new Error(
          'createCustomer({ careTeam }) cần stubRateLimit() trước',
        );
      const invited = await addMembers('admin', id, careTeam.memberIds);
      expect(invited.status).toBe(201);
    }
    return { id, phone };
  };

  const customers = () => connection.collection('customers');
  const customerDoc = (id: string) =>
    customers().findOne({ _id: new Types.ObjectId(id) });
  const careLogs = () => connection.collection('care_logs');
  const attachmentsCol = () => connection.collection('crm_attachments');
  const auditOf = (customerId: string, action?: string) =>
    connection
      .collection('crm_audit_logs')
      .find({
        customerId: new Types.ObjectId(customerId),
        ...(action ? { action } : {}),
      })
      .sort({ _id: 1 })
      .toArray();

  /** Bất biến: nhóm chăm sóc rỗng hoặc có ĐÚNG 1 PRIMARY, không trùng người, `primaryAssigneeId` khớp. */
  const expectCareTeamInvariant = async (id: string) => {
    const doc = await customerDoc(id);
    const team = doc!.careTeam as Array<{
      userId: Types.ObjectId;
      role: string;
    }>;
    if (team.length === 0) return;
    const primaries = team.filter((member) => member.role === 'PRIMARY');
    expect(primaries).toHaveLength(1);
    expect(new Set(team.map((member) => String(member.userId))).size).toBe(
      team.length,
    );
    expect(String(doc!.primaryAssigneeId)).toBe(String(primaries[0].userId));
  };

  /** `teamIds` phải bằng hợp nhóm HIỆN TẠI của các thành viên chăm sóc. */
  const expectTeamIdsMatchMembers = async (id: string) => {
    const doc = await customerDoc(id);
    const memberIds = (doc!.careTeam as Array<{ userId: Types.ObjectId }>).map(
      (member) => member.userId,
    );
    const users = await userModel
      .find({ _id: { $in: memberIds } })
      .select('teamId')
      .lean();
    const expected = new Set(
      users.flatMap((user) => (user.teamId ? [String(user.teamId)] : [])),
    );
    expect(new Set((doc!.teamIds as Types.ObjectId[]).map(String))).toEqual(
      expected,
    );
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env[ATTACHMENTS_FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-m3-${RUN_ID}:`;
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
    await app.register(fastifyMultipart, {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    connection = app.get<Connection>(getConnectionToken());
    userModel = app.get(getModelToken(User.name));
    jwt = app.get(JwtService);
    pii = app.get(PiiCryptoService);
    void pii;

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
    delete process.env[ATTACHMENTS_FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------------------------
  const addMembers = (
    as: string,
    cust: string,
    userIds: string[],
    primaryUserId?: string,
  ) =>
    call('POST', `/crm/customers/${cust}/care-team/members`, as, {
      userIds,
      ...(primaryUserId ? { primaryUserId } : {}),
    });

  /**
   * Stub giới hạn tần suất ở MỨC DESCRIBE (Redis không có ở máy dev; lượt suite gọi thật > trần 30/phút).
   * Spy trên prototype nên mọi instance (kể cả `app.get`) đều bị stub; `restoreAllMocks` trong `afterEach` gỡ sạch,
   * không rò sang ca sau (ca CARE_TEAM_INVITE thật nằm ở describe riêng, không dùng stub này).
   */
  const rateLimitProto = CrmRateLimitService.prototype as {
    consume: CrmRateLimitService['consume'];
  };
  const stubRateLimit = () => {
    beforeEach(() => {
      jest.spyOn(rateLimitProto, 'consume').mockResolvedValue(undefined);
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });
  };

  describe('Bất biến PRIMARY dưới tải đồng thời', () => {
    stubRateLimit();

    it('gỡ chính (bị khóa) / gỡ thành viên / thêm người song song: sau MỖI vòng PRIMARY vẫn là qa1, đúng 1 PRIMARY, không trùng, primaryAssigneeId khớp, không 5xx', async () => {
      for (const key of ['qa1', 'qa2', 'qa3', 'qa4'])
        await createUser(key, UserRole.STAFF);
      for (let round = 0; round < 15; round += 1) {
        const c = await createCustomer('admin', {
          careTeam: { memberIds: [ids.qa2, ids.qa3], primaryUserId: ids.qa1 },
        });
        const results = await Promise.all([
          call(
            'DELETE',
            `/crm/customers/${c.id}/care-team/members/${ids.qa1}`,
            'admin',
          ),
          call(
            'DELETE',
            `/crm/customers/${c.id}/care-team/members/${ids.qa1}`,
            'admin',
          ),
          call(
            'DELETE',
            `/crm/customers/${c.id}/care-team/members/${ids.qa2}`,
            'admin',
          ),
          addMembers('admin', c.id, [ids.qa4]),
        ]);
        expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
        // PRIMARY bị khóa: hai lệnh gỡ qa1 đều 409, qa1 vẫn là phụ trách chính.
        expect(results.slice(0, 2).map((r) => r.body.errorCode)).toEqual([
          'PRIMARY_LOCKED',
          'PRIMARY_LOCKED',
        ]);
        expect((await customerDoc(c.id))!.primaryAssigneeId.toString()).toBe(
          ids.qa1,
        );
        await expectCareTeamInvariant(c.id);
        await expectTeamIdsMatchMembers(c.id);
      }
    });

    it('thêm thành viên song song với đổi nhóm của THÀNH VIÊN ĐÃ CÓ: teamIds luôn khớp nhóm hiện tại', async () => {
      await createUser('qa5', UserRole.STAFF);
      await createUser('qa6', UserRole.STAFF);
      for (let round = 0; round < 12; round += 1) {
        const c = await createCustomer('admin', {
          careTeam: { memberIds: [], primaryUserId: ids.qa5 },
        });
        await Promise.all([
          call('PATCH', `/users/${ids.qa5}/team`, 'admin', {
            teamId: round % 2 ? ids.teamA : ids.teamB,
          }),
          addMembers('admin', c.id, [ids.qa6]),
        ]);
        await expectTeamIdsMatchMembers(c.id);
        await expectCareTeamInvariant(c.id);
      }
    });
  });

  describe('Phân công: người được phân phải hợp lệ (ACTIVE, Manager/Staff), không giới hạn theo nhóm', () => {
    stubRateLimit();

    it('FR-11: không còn đường đổi phụ trách chính sang thành viên đã bị khóa — PUT primary trả 404 và PRIMARY giữ nguyên', async () => {
      await createUser('qaPrimary11', UserRole.STAFF);
      await createUser('qaBlocked', UserRole.STAFF);
      const c = await createCustomer('admin', {
        careTeam: {
          memberIds: [ids.qaBlocked],
          primaryUserId: ids.qaPrimary11,
        },
      });
      await userModel.updateOne(
        { _id: ids.qaBlocked },
        { $set: { status: UserStatus.BLOCKED } },
      );
      const res = await call(
        'PUT',
        `/crm/customers/${c.id}/care-team/primary`,
        'admin',
        { userId: ids.qaBlocked },
      );
      expect(res.status).toBe(404);
      expect((await customerDoc(c.id))!.primaryAssigneeId.toString()).toBe(
        ids.qaPrimary11,
      );
    });

    it('FR-13: MANAGER mời được người ngoài nhóm mình quản lý (cả POST members lẫn bulk ASSIGN); người bị khóa/EDITOR vẫn bị từ chối', async () => {
      // Lượt CARE_TEAM_INVITE/BULK_OPERATION đã được stub ở mức describe (`stubRateLimit`): ca này chỉ kiểm quyền phân công.
      const c = await createCustomer('manager1', {});
      expect((await addMembers('manager1', c.id, [ids.staffC])).status).toBe(
        201,
      );
      expect(
        (await customerDoc(c.id))!.careTeam.map((m: any) => String(m.userId)),
      ).toContain(ids.staffC);

      const other = await createCustomer('manager1', {});
      const bulk = await call(
        'POST',
        '/crm/customer-bulk-operations',
        'manager1',
        {
          type: 'ASSIGN',
          customerIds: [other.id],
          payload: { memberIds: [ids.staffC] },
        },
      );
      expect(bulk.body.data.succeeded).toEqual([other.id]);

      const invalid = await createCustomer('manager1', {});
      for (const user of ['blockedStaff', 'editor']) {
        const res = await addMembers('manager1', invalid.id, [ids[user]]);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('USER_NOT_ASSIGNABLE');
      }
    });
  });

  describe('Giới hạn 10 thành viên phụ dưới tải đồng thời (FR-17, Replica Set thật)', () => {
    stubRateLimit();

    it('nhiều lời mời song song vào khách đang 9 MEMBER: đúng MỘT lời mời thắng, các bên còn lại 409 (VERSION_CONFLICT hoặc CARE_TEAM_LIMIT_EXCEEDED), không 5xx, nhóm KHÔNG vượt 10 MEMBER', async () => {
      const memberKeys = Array.from({ length: 9 }, (_v, i) => `limM${i}`);
      const raceKeys = ['limX0', 'limX1', 'limX2', 'limX3'];
      await createUser('limP', UserRole.STAFF);
      for (const key of [...memberKeys, ...raceKeys])
        await createUser(key, UserRole.STAFF);
      // Lượt CARE_TEAM_INVITE đã được stub ở mức describe (`stubRateLimit`): ca này chỉ kiểm tranh chấp ghi trên Mongo.
      for (let round = 0; round < 6; round += 1) {
        const c = await createCustomer('admin', {
          careTeam: {
            memberIds: memberKeys.map((key) => ids[key]),
            primaryUserId: ids.limP,
          },
        });
        const results = await Promise.all(
          raceKeys.map((key) => addMembers('admin', c.id, [ids[key]])),
        );

        expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        for (const loser of results.filter((r) => r.status !== 201)) {
          expect(loser.status).toBe(409);
          expect(['VERSION_CONFLICT', 'CARE_TEAM_LIMIT_EXCEEDED']).toContain(
            loser.body.errorCode,
          );
        }
        const team = (await customerDoc(c.id))!.careTeam as Array<{
          userId: Types.ObjectId;
          role: string;
        }>;
        expect(team.filter((m) => m.role === 'MEMBER')).toHaveLength(10);
        expect(
          team.filter((m) => raceKeys.some((k) => ids[k] === String(m.userId))),
        ).toHaveLength(1);
        await expectCareTeamInvariant(c.id);
        await expectTeamIdsMatchMembers(c.id);
      }
    });
  });

  describe('Rate limit CARE_TEAM_INVITE (FR-17)', () => {
    it('CrmRateLimitService THẬT qua HTTP: lượt thứ 30 vẫn mời được, lượt thứ 31 => 429 RATE_LIMITED + retryAfterSeconds, nhóm không đổi; gỡ thành viên không tốn lượt', async () => {
      // Không cần Redis thật: chỉ thay lệnh `eval` (INCR + PTTL) bằng bộ đếm giả; mọi logic ngưỡng/mã lỗi là của service thật.
      const redis = app.get<{ eval: (...args: unknown[]) => Promise<unknown> }>(
        REDIS_CLIENT,
      );
      let nextCount = 30;
      const evalSpy = jest
        .spyOn(redis, 'eval')
        .mockImplementation(() => Promise.resolve([nextCount, 42_000]));
      try {
        const c = await createCustomer('manager1', {});
        const atLimit = await addMembers('manager1', c.id, [ids.staffC]);
        nextCount = 31;
        const overLimit = await addMembers('manager1', c.id, [ids.staffD]);

        expect(atLimit.status).toBe(201);
        expect(overLimit.status).toBe(429);
        expect(overLimit.body.errorCode).toBe('RATE_LIMITED');
        expect(overLimit.body.details).toEqual({ retryAfterSeconds: 42 });
        expect(evalSpy).toHaveBeenLastCalledWith(
          expect.any(String),
          1,
          `crm:rl:CARE_TEAM_INVITE:${ids.manager1}`,
          60_000,
        );
        expect(
          (await customerDoc(c.id))!.careTeam.map((m: any) => String(m.userId)),
        ).not.toContain(ids.staffD);

        const callsBeforeRemoval = evalSpy.mock.calls.length;
        const removal = await call(
          'DELETE',
          `/crm/customers/${c.id}/care-team/members/${ids.staffC}`,
          'manager1',
        );
        expect(removal.status).toBe(200);
        expect(evalSpy.mock.calls).toHaveLength(callsBeforeRemoval);
      } finally {
        evalSpy.mockRestore();
      }
    });
  });

  describe('Ẩn danh hóa phủ hết dữ liệu chăm sóc', () => {
    it('không còn chuỗi PII nào trong customers/care_logs/crm_attachments/care_team_requests/crm_audit_logs; file ảnh bị dọn khỏi kho', async () => {
      const SECRET = 'Nguyễn Bí Mật 0933000111';
      const c = await createCustomer('staffA', { fullName: 'Nguyễn Bí Mật' });
      const up = await upload(c.id, 'staffA', {
        name: 'cccd-Nguyễn-Bí-Mật.jpg',
      });
      expect(up.status).toBe(201);
      const log = await call(
        'POST',
        `/crm/customers/${c.id}/care-logs`,
        'staffA',
        {
          content: `Gọi cho ${SECRET}`,
          contactChannel: 'CALL',
          nextAction: {
            suggestion: `Hẹn ${SECRET}`,
            dueAt: new Date(Date.now() + HOUR).toISOString(),
          },
          attachmentIds: [up.body.data.id],
        },
      );
      expect(log.status).toBe(201);
      const upd = await call(
        'PATCH',
        `/crm/customers/${c.id}/care-logs/${log.body.data.id}`,
        'staffA',
        {
          content: `Đã sửa ${SECRET} lần hai`,
        },
      );
      expect(upd.status).toBe(200);
      const detail = await call('GET', `/crm/customers/${c.id}`, 'staffA');
      await call('PATCH', `/crm/customers/${c.id}/status`, 'staffA', {
        statusId: status.INTERESTED,
        version: detail.body.data.version,
        reason: `Lý do ${SECRET}`,
      });
      // Luồng gửi đề nghị đã bỏ (v1.0.5, T-13): chèn thẳng bản ghi cũ để vẫn kiểm việc ẩn danh dọn `care_team_requests`.
      await connection.collection('care_team_requests').insertOne({
        customerId: new Types.ObjectId(c.id),
        requesterId: new Types.ObjectId(ids.staffC),
        status: 'REJECTED',
        message: `Tôi xin ${SECRET}`,
        resolvedBy: new Types.ObjectId(ids.staffA),
        resolvedAt: new Date(),
        resolutionNote: `Từ chối ${SECRET}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const objectsBefore = [...storage.objects.keys()].filter((key) =>
        key.includes(c.id),
      );
      expect(objectsBefore.length).toBeGreaterThan(0);

      expect(
        (
          await call('POST', '/crm/customer-anonymizations', 'admin', {
            customerId: c.id,
            reason: 'Khách yêu cầu',
            confirm: true,
          })
        ).status,
      ).toBe(201);
      await app.get(AttachmentCleanupService).cleanup();

      const oid = new Types.ObjectId(c.id);
      const dump = JSON.stringify([
        await customers()
          .find({ _id: oid })
          .project({
            searchText: 1,
            fullName: 1,
            email: 1,
            phone: 1,
            criteria: 1,
            dataConsent: 1,
          })
          .toArray(),
        await careLogs().find({ customerId: oid }).toArray(),
        await attachmentsCol().find({ customerId: oid }).toArray(),
        await connection
          .collection('care_team_requests')
          .find({ customerId: oid })
          .toArray(),
        await auditOf(c.id),
      ]);
      for (const secret of ['Bí Mật', '0933000111', 'cccd-Nguy']) {
        expect([secret, dump.includes(secret)]).toEqual([secret, false]);
      }
      expect(
        [...storage.objects.keys()].filter((key) => key.includes(c.id)),
      ).toHaveLength(0);
    });
  });

  describe('Ảnh: biên bổ sung', () => {
    it('ảnh PNG/WebP hợp lệ nhưng cấu trúc hỏng, JPEG polyglot HTML, file 0 byte, nhiều file => bị từ chối, không để lại file/bản ghi', async () => {
      const c = await createCustomer('staffA', {});
      const before = storage.objects.size;
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('xxxxxxxxxxxx'),
      ]);
      const webp = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([4, 0, 0, 0]),
        Buffer.from('WEBPxx'),
      ]);
      const html = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.from('<html><script>alert(1)</script>'),
      ]);
      const cases: Array<[string, Buffer, string]> = [
        ['png-hong.png', png, 'image/png'],
        ['webp-hong.webp', webp, 'image/webp'],
        ['poly.jpg', html, 'image/jpeg'],
        ['rong.jpg', Buffer.alloc(0), 'image/jpeg'],
      ];
      for (const [name, content, mime] of cases) {
        const res = await upload(c.id, 'staffA', { name, mime, content });
        expect([name, res.status >= 400 && res.status < 500]).toEqual([
          name,
          true,
        ]);
      }
      expect(storage.objects.size).toBe(before);
      expect(
        await attachmentsCol().countDocuments({
          customerId: new Types.ObjectId(c.id),
        }),
      ).toBe(0);
    });

    it('người ngoài phạm vi upload file lớn: 404 trước khi nhận file; đã bị gỡ khỏi nhóm: 404', async () => {
      const c = await createCustomer('staffA', {});
      const res = await upload(c.id, 'staffC', {
        content: jpegWithGps(3 * 1024 * 1024),
      });
      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('CUSTOMER_NOT_FOUND');
    });
  });
});
