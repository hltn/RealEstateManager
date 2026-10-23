/**
 * INTEGRATION — CRM M3 (chăm sóc) qua HTTP thật: Fastify (+ @fastify/multipart) + ValidationPipe + GlobalExceptionFilter
 * + JwtAuthGuard/RolesGuard + CrmFeatureGuard trên MongoDB Replica Set thật (mongodb-memory-server) và Redis THẬT
 * (idempotency + rate limit; `docker compose -f docker-compose.dev.yml up -d --wait`, key có tiền tố riêng mỗi lần chạy).
 * Kho ảnh (MinIO/S3) được thay bằng bản giả trong bộ nhớ: test không ghi vào bucket thật.
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
import { Test } from '@nestjs/testing';
import fastifyMultipart from '@fastify/multipart';
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
import { UsersModule } from '../users/users.module';
import { PiiCryptoService } from './common/crypto/pii-crypto.service';
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

describe('CRM M3 — chăm sóc: nhóm chăm sóc, đề nghị tham gia, nhật ký + ảnh, thao tác hàng loạt', () => {
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

  const createCustomer = async (
    as: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; phone: string }> => {
    const phone = nextPhone();
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
      ...extra,
    });
    expect(res.status).toBe(201);
    return { id: res.body.data.id, phone };
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

  const memberIdsOf = (res: Res) =>
    res.body.data.members.map((member: any) => member.user.id);

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env[ATTACHMENTS_FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-m3-${RUN_ID}:`;
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
  describe('Nhóm chăm sóc: thêm / đổi chính / gỡ, luôn đúng 1 PRIMARY, đồng bộ teamIds', () => {
    let c1: string;

    it('xem nhóm: thành viên xem được, người ngoài nhóm 404', async () => {
      ({ id: c1 } = await createCustomer('staffA'));

      const mine = await call(
        'GET',
        `/crm/customers/${c1}/care-team`,
        'staffA',
      );
      expect(mine.status).toBe(200);
      expect(mine.body.data.primary).toMatchObject({ id: ids.staffA });
      expect(mine.body.data.members).toHaveLength(1);

      const outsider = await call(
        'GET',
        `/crm/customers/${c1}/care-team`,
        'staffC',
      );
      expect(outsider.status).toBe(404);
      expect(outsider.body.errorCode).toBe('CUSTOMER_NOT_FOUND');
      expect(
        (await call('GET', `/crm/customers/${c1}/care-team`, 'editor')).status,
      ).toBe(403);
    });

    it('phụ trách chính thêm người cùng nhóm; thành viên thường 403; người khác nhóm/bị khóa/EDITOR 400 USER_NOT_ASSIGNABLE', async () => {
      const added = await call(
        'POST',
        `/crm/customers/${c1}/care-team/members`,
        'staffA',
        { userIds: [ids.staffB] },
      );
      expect(added.status).toBe(201);
      expect(memberIdsOf(added)).toEqual([ids.staffA, ids.staffB]);
      expect(added.body.data.primary.id).toBe(ids.staffA);
      expect((await customerDoc(c1))!.teamIds.map(String)).toEqual([ids.teamA]);
      expect(await auditOf(c1, 'CARE_TEAM_MEMBER_ADDED')).toHaveLength(1);

      const memberAdds = await call(
        'POST',
        `/crm/customers/${c1}/care-team/members`,
        'staffB',
        { userIds: [ids.staffD] },
      );
      expect(memberAdds.status).toBe(403);
      expect(memberAdds.body.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');

      // Phụ trách chính (Nhân viên) chỉ phân cho người cùng nhóm; Quản lý chỉ cho nhóm mình quản lý.
      for (const [who, target] of [
        ['staffA', 'staffC'],
        ['manager1', 'staffC'],
        ['admin', 'blockedStaff'],
        ['admin', 'editor'],
        ['admin', 'admin'],
      ]) {
        const res = await call(
          'POST',
          `/crm/customers/${c1}/care-team/members`,
          who,
          { userIds: [ids[target]] },
        );
        expect([who, target, res.status, res.body.errorCode]).toEqual([
          who,
          target,
          400,
          'USER_NOT_ASSIGNABLE',
        ]);
      }
    });

    it('thêm trùng => 409; gửi primaryUserId khi nhóm đã có người => 400; Quản trị thêm người nhóm khác => teamIds mở rộng và Quản lý nhóm đó thấy khách', async () => {
      const duplicate = await call(
        'POST',
        `/crm/customers/${c1}/care-team/members`,
        'staffA',
        { userIds: [ids.staffB] },
      );
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.errorCode).toBe('ALREADY_IN_CARE_TEAM');

      const swapViaAdd = await call(
        'POST',
        `/crm/customers/${c1}/care-team/members`,
        'staffA',
        { userIds: [ids.staffB], primaryUserId: ids.staffB },
      );
      expect(swapViaAdd.status).toBe(409);
      const withPrimary = await call(
        'POST',
        `/crm/customers/${c1}/care-team/members`,
        'admin',
        { userIds: [ids.staffD], primaryUserId: ids.staffD },
      );
      expect(withPrimary.status).toBe(400);

      expect((await customerDoc(c1))!.teamIds.map(String)).toEqual([ids.teamA]);
      expect(
        (
          await call('GET', '/crm/customers?limit=100', 'manager2')
        ).body.data.map((item: any) => item.id),
      ).not.toContain(c1);

      const crossTeam = await call(
        'POST',
        `/crm/customers/${c1}/care-team/members`,
        'admin',
        { userIds: [ids.staffC] },
      );
      expect(crossTeam.status).toBe(201);
      expect(new Set((await customerDoc(c1))!.teamIds.map(String))).toEqual(
        new Set([ids.teamA, ids.teamB]),
      );
      expect(
        (
          await call('GET', '/crm/customers?limit=100', 'manager2')
        ).body.data.map((item: any) => item.id),
      ).toContain(c1);
      await expectCareTeamInvariant(c1);
    });

    it('đổi phụ trách chính: chỉ Quản trị/Quản lý; người cũ thành MEMBER; luôn đúng 1 PRIMARY', async () => {
      const forbidden = await call(
        'PUT',
        `/crm/customers/${c1}/care-team/primary`,
        'staffA',
        { userId: ids.staffB },
      );
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');

      const changed = await call(
        'PUT',
        `/crm/customers/${c1}/care-team/primary`,
        'manager1',
        { userId: ids.staffB },
      );
      expect(changed.status).toBe(200);
      expect(changed.body.data.primary.id).toBe(ids.staffB);
      expect(
        changed.body.data.members.find((m: any) => m.user.id === ids.staffA)
          .role,
      ).toBe('MEMBER');
      await expectCareTeamInvariant(c1);
      const [audit] = await auditOf(c1, 'PRIMARY_CHANGED');
      expect(audit.changes[0]).toMatchObject({
        field: 'primaryAssignee',
        from: 'staffA',
        to: 'staffB',
      });

      // Đổi sang chính người đang là phụ trách chính: không có gì thay đổi (không audit thêm).
      const again = await call(
        'PUT',
        `/crm/customers/${c1}/care-team/primary`,
        'manager1',
        { userId: ids.staffB },
      );
      expect(again.status).toBe(200);
      expect(await auditOf(c1, 'PRIMARY_CHANGED')).toHaveLength(1);
    });

    it('gỡ: phụ trách chính phải có người thay (chỉ Quản trị/Quản lý); thành viên thường không gỡ được ai; người thay là người mới thì phải hợp lệ', async () => {
      const [selfRemove, memberRemove] = await Promise.all([
        call(
          'DELETE',
          `/crm/customers/${c1}/care-team/members/${ids.staffB}`,
          'staffB',
        ),
        call(
          'DELETE',
          `/crm/customers/${c1}/care-team/members/${ids.staffC}`,
          'staffA',
        ),
      ]);
      expect(selfRemove.status).toBe(403);
      expect(memberRemove.status).toBe(403);

      const noReplacement = await call(
        'DELETE',
        `/crm/customers/${c1}/care-team/members/${ids.staffB}`,
        'manager1',
      );
      expect(noReplacement.status).toBe(400);
      expect(noReplacement.body.errorCode).toBe('PRIMARY_REPLACEMENT_REQUIRED');

      const invalidReplacement = await call(
        'DELETE',
        `/crm/customers/${c1}/care-team/members/${ids.staffB}?newPrimaryUserId=${ids.staffD}`,
        'manager1',
      );
      expect(invalidReplacement.status).toBe(400);
      expect(invalidReplacement.body.errorCode).toBe('USER_NOT_ASSIGNABLE');

      // staffC đã là thành viên nhưng thuộc nhóm B (ngoài phạm vi Quản lý nhóm A): vẫn phải bị từ chối.
      const outOfScopeReplacement = await call(
        'DELETE',
        `/crm/customers/${c1}/care-team/members/${ids.staffB}?newPrimaryUserId=${ids.staffC}`,
        'manager1',
      );
      expect(outOfScopeReplacement.status).toBe(400);
      expect(outOfScopeReplacement.body.errorCode).toBe('USER_NOT_ASSIGNABLE');

      const removed = await call(
        'DELETE',
        `/crm/customers/${c1}/care-team/members/${ids.staffB}?newPrimaryUserId=${ids.staffC}`,
        'admin',
      );
      expect(removed.status).toBe(200);
      expect(memberIdsOf(removed).sort()).toEqual(
        [ids.staffA, ids.staffC].sort(),
      );
      expect(removed.body.data.primary.id).toBe(ids.staffC);
      await expectCareTeamInvariant(c1);
      await expectTeamIdsMatchMembers(c1);
      expect(await auditOf(c1, 'CARE_TEAM_MEMBER_REMOVED')).toHaveLength(1);

      const notMember = await call(
        'DELETE',
        `/crm/customers/${c1}/care-team/members/${ids.staffB}`,
        'admin',
      );
      expect(notMember.status).toBe(404);
      expect(notMember.body.errorCode).toBe('RESOURCE_NOT_FOUND');
    });

    it('nhân viên bị gỡ khỏi nhóm => 404 ở MỌI endpoint con của khách đó (không phải 403)', async () => {
      const probes: Array<[Parameters<typeof call>[0], string, unknown]> = [
        ['GET', `/crm/customers/${c1}`, undefined],
        ['GET', `/crm/customers/${c1}/care-team`, undefined],
        [
          'POST',
          `/crm/customers/${c1}/care-team/members`,
          { userIds: [ids.staffD] },
        ],
        [
          'PUT',
          `/crm/customers/${c1}/care-team/primary`,
          { userId: ids.staffB },
        ],
        ['GET', `/crm/customers/${c1}/care-logs`, undefined],
        [
          'POST',
          `/crm/customers/${c1}/care-logs`,
          { content: 'x', contactChannel: 'CALL' },
        ],
        ['POST', `/crm/customers/${c1}/care-log-attachments`, undefined],
        ['POST', `/crm/customers/${c1}/phone-views`, { purpose: 'VIEW' }],
        ['GET', `/crm/customers/${c1}/histories`, undefined],
      ];
      for (const [method, url, body] of probes) {
        const res = await call(method, url, 'staffB', body);
        expect([method, url, res.status, res.body?.errorCode]).toEqual([
          method,
          url,
          404,
          'CUSTOMER_NOT_FOUND',
        ]);
      }
    });

    it('Quản trị gỡ phụ trách chính và chọn người thay chưa có trong nhóm (không nhóm): người thay được thêm làm PRIMARY, teamIds cập nhật theo nhóm hiện tại', async () => {
      const res = await call(
        'DELETE',
        `/crm/customers/${c1}/care-team/members/${ids.staffC}?newPrimaryUserId=${ids.staffD}`,
        'admin',
      );
      expect(res.status).toBe(200);
      expect(res.body.data.primary.id).toBe(ids.staffD);
      expect(memberIdsOf(res).sort()).toEqual([ids.staffA, ids.staffD].sort());
      await expectCareTeamInvariant(c1);
      await expectTeamIdsMatchMembers(c1);
      // staffC rời nhóm => Quản lý nhóm B mất quyền với khách này ngay.
      expect(
        (await call('GET', `/crm/customers/${c1}`, 'manager2')).status,
      ).toBe(404);
    });

    it('đồng thời: nhiều người cùng thêm thành viên không mất cập nhật; thêm trùng một người chỉ thành công một lần', async () => {
      const { id } = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
      });
      const adds = await Promise.all(
        ['staffB', 'staffC', 'staffD'].map((who) =>
          call('POST', `/crm/customers/${id}/care-team/members`, 'admin', {
            userIds: [ids[who]],
          }),
        ),
      );
      expect(adds.map((res) => res.status)).toEqual([201, 201, 201]);
      const doc = await customerDoc(id);
      expect(doc!.careTeam).toHaveLength(4);
      await expectCareTeamInvariant(id);
      await expectTeamIdsMatchMembers(id);

      const { id: other } = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffA },
      });
      const same = await Promise.all(
        [1, 2, 3, 4].map(() =>
          call('POST', `/crm/customers/${other}/care-team/members`, 'admin', {
            userIds: [ids.staffB],
          }),
        ),
      );
      expect(same.filter((res) => res.status === 201)).toHaveLength(1);
      expect(
        same.filter(
          (res) =>
            res.status === 409 && res.body.errorCode === 'ALREADY_IN_CARE_TEAM',
        ),
      ).toHaveLength(3);
      await expectCareTeamInvariant(other);
    });

    it('đồng thời với đổi nhóm của người dùng: teamIds của khách luôn khớp nhóm HIỆN TẠI của thành viên (không write-skew)', async () => {
      for (let round = 0; round < 6; round += 1) {
        const { id } = await createCustomer('admin', {
          careTeam: { memberIds: [], primaryUserId: ids.staffA },
        });
        const [add, move] = await Promise.all([
          call('POST', `/crm/customers/${id}/care-team/members`, 'admin', {
            userIds: [ids.staffD],
          }),
          call('PATCH', `/users/${ids.staffD}/team`, 'admin', {
            teamId: ids[round % 2 === 0 ? 'teamB' : 'teamA'],
          }),
        ]);
        expect([add.status, move.status]).toEqual([201, 200]);
        await expectTeamIdsMatchMembers(id);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Đề nghị tham gia nhóm chăm sóc', () => {
    let cr: string;
    let crPhone: string;
    let requestId: string;

    it('gửi đề nghị: customerRef từ phone-lookups; hasPendingRequest phản ánh đề nghị đang chờ; trùng/đã trong nhóm/không tồn tại bị từ chối', async () => {
      ({ id: cr, phone: crPhone } = await createCustomer('staffA', {
        fullName: 'Khách Cần Xin Vào',
      }));
      await call('POST', `/crm/customers/${cr}/care-team/members`, 'staffA', {
        userIds: [ids.staffB],
      });

      const before = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'staffD',
        {
          phone: crPhone,
        },
      );
      expect(before.body.data).toMatchObject({
        exists: true,
        isAccessible: false,
        canRequestJoin: true,
        hasPendingRequest: false,
        customerRef: cr,
      });

      const created = await call('POST', '/crm/care-team-requests', 'staffD', {
        customerRef: cr,
        message: 'Em quen khách này, xin tham gia',
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ status: 'PENDING' });
      requestId = created.body.data.id;

      const after = await call(
        'POST',
        '/crm/customers/phone-lookups',
        'staffD',
        {
          phone: crPhone,
        },
      );
      expect(after.body.data.hasPendingRequest).toBe(true);
      // Người khác chưa gửi nên vẫn false.
      expect(
        (
          await call('POST', '/crm/customers/phone-lookups', 'staffC', {
            phone: crPhone,
          })
        ).body.data.hasPendingRequest,
      ).toBe(false);

      const duplicate = await call(
        'POST',
        '/crm/care-team-requests',
        'staffD',
        {
          customerRef: cr,
        },
      );
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.errorCode).toBe('JOIN_REQUEST_EXISTS');

      const alreadyIn = await call(
        'POST',
        '/crm/care-team-requests',
        'staffA',
        {
          customerRef: cr,
        },
      );
      expect(alreadyIn.status).toBe(409);
      expect(alreadyIn.body.errorCode).toBe('ALREADY_IN_CARE_TEAM');

      expect(
        (
          await call('POST', '/crm/care-team-requests', 'staffC', {
            customerRef: new Types.ObjectId().toHexString(),
          })
        ).status,
      ).toBe(404);
      // Quản trị không cần đề nghị (đã thấy mọi khách); EDITOR không có quyền CRM.
      expect(
        (
          await call('POST', '/crm/care-team-requests', 'admin', {
            customerRef: cr,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('POST', '/crm/care-team-requests', 'editor', {
            customerRef: cr,
          })
        ).status,
      ).toBe(403);
    });

    it('hộp "mình gửi" không lộ tên khách; hộp "cần duyệt" chỉ có người duyệt hợp lệ (Quản trị, Quản lý trong phạm vi, phụ trách chính)', async () => {
      const mine = await call(
        'GET',
        '/crm/care-team-requests?box=mine',
        'staffD',
      );
      expect(mine.status).toBe(200);
      expect(mine.body.meta.total).toBe(1);
      expect(mine.body.data[0]).toMatchObject({
        id: requestId,
        status: 'PENDING',
        requester: { id: ids.staffD },
        customer: { id: cr },
      });
      expect(mine.body.data[0].customer.fullName).toBeUndefined();

      const toReview = (who: string, query = '') =>
        call('GET', `/crm/care-team-requests?box=to-review${query}`, who);
      const reviewers: Array<[string, number]> = [
        ['staffA', 1], // phụ trách chính
        ['admin', 1],
        ['manager1', 1], // Quản lý nhóm A
        ['staffB', 0], // thành viên thường
        ['staffC', 0], // ngoài nhóm
        ['manager2', 0], // Quản lý nhóm khác
        ['staffD', 0], // chính người gửi
      ];
      for (const [who, expected] of reviewers) {
        const res = await toReview(who);
        expect([who, res.status, res.body.meta.total]).toEqual([
          who,
          200,
          expected,
        ]);
      }
      const seen = await toReview('staffA');
      expect(seen.body.data[0].customer).toMatchObject({
        id: cr,
        fullName: 'Khách Cần Xin Vào',
      });
      expect(
        (await toReview('staffA', '&status=APPROVED')).body.meta.total,
      ).toBe(0);
      expect(
        (await call('GET', '/crm/care-team-requests', 'staffA')).status,
      ).toBe(400);
    });

    it('duyệt: thành viên thường 403, người gửi tự duyệt/người lạ hủy 404; phụ trách chính duyệt => thêm MEMBER; duyệt lại 409', async () => {
      const member = await call(
        'PATCH',
        `/crm/care-team-requests/${requestId}`,
        'staffB',
        { status: 'APPROVED' },
      );
      expect(member.status).toBe(403);
      expect(member.body.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');
      expect(
        (
          await call(
            'PATCH',
            `/crm/care-team-requests/${requestId}`,
            'staffD',
            { status: 'APPROVED' },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            'PATCH',
            `/crm/care-team-requests/${requestId}`,
            'staffC',
            { status: 'CANCELED' },
          )
        ).status,
      ).toBe(404);

      const approved = await call(
        'PATCH',
        `/crm/care-team-requests/${requestId}`,
        'staffA',
        { status: 'APPROVED', resolutionNote: 'OK' },
      );
      expect(approved.status).toBe(200);
      expect(approved.body.data).toMatchObject({
        status: 'APPROVED',
        resolvedBy: { id: ids.staffA },
      });
      const doc = await customerDoc(cr);
      expect(
        doc!.careTeam.find((m: any) => String(m.userId) === ids.staffD),
      ).toMatchObject({ role: 'MEMBER' });
      await expectCareTeamInvariant(cr);
      await expectTeamIdsMatchMembers(cr);
      expect((await call('GET', `/crm/customers/${cr}`, 'staffD')).status).toBe(
        200,
      );
      expect(await auditOf(cr, 'JOIN_REQUEST_RESOLVED')).toHaveLength(1);

      const again = await call(
        'PATCH',
        `/crm/care-team-requests/${requestId}`,
        'staffA',
        { status: 'REJECTED' },
      );
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe('JOIN_REQUEST_RESOLVED');
    });

    it('người gửi hủy được và gửi lại được; duyệt và hủy đồng thời chỉ một bên thắng, trạng thái và nhóm luôn nhất quán', async () => {
      const { id } = await createCustomer('staffA');
      const first = await call('POST', '/crm/care-team-requests', 'staffC', {
        customerRef: id,
      });
      expect(first.status).toBe(201);
      const canceled = await call(
        'PATCH',
        `/crm/care-team-requests/${first.body.data.id}`,
        'staffC',
        { status: 'CANCELED' },
      );
      expect(canceled.status).toBe(200);
      expect(canceled.body.data.status).toBe('CANCELED');

      const second = await call('POST', '/crm/care-team-requests', 'staffC', {
        customerRef: id,
      });
      expect(second.status).toBe(201);
      const [approve, cancel] = await Promise.all([
        call(
          'PATCH',
          `/crm/care-team-requests/${second.body.data.id}`,
          'admin',
          { status: 'APPROVED' },
        ),
        call(
          'PATCH',
          `/crm/care-team-requests/${second.body.data.id}`,
          'staffC',
          { status: 'CANCELED' },
        ),
      ]);
      expect([approve.status, cancel.status].sort()).toEqual([200, 409]);
      const stored = await connection
        .collection('care_team_requests')
        .findOne({ _id: new Types.ObjectId(second.body.data.id) });
      const inTeam = (await customerDoc(id))!.careTeam.some(
        (m: any) => String(m.userId) === ids.staffC,
      );
      expect(inTeam).toBe(stored!.status === 'APPROVED');
      expect(['APPROVED', 'CANCELED']).toContain(stored!.status);

      const mine = await call(
        'GET',
        '/crm/care-team-requests?box=mine&limit=100',
        'staffC',
      );
      expect(mine.body.meta.total).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Nhật ký chăm sóc', () => {
    let cl: string;
    let contactResultId: string;
    let logA: string;

    it('ghi nhật ký: cập nhật lastCareLogAt (không tăng version), idempotency chống đúp, mốc backdate không kéo lùi, tương lai bị từ chối', async () => {
      ({ id: cl } = await createCustomer('staffA'));
      await call('POST', `/crm/customers/${cl}/care-team/members`, 'staffA', {
        userIds: [ids.staffB],
      });
      const list = await call('GET', '/crm/contact-results', 'staffA');
      contactResultId = list.body.data[0].id;

      const before = await customerDoc(cl);
      const key = randomUUID();
      const send = () =>
        call(
          'POST',
          `/crm/customers/${cl}/care-logs`,
          'staffA',
          {
            content: 'Gọi lần 1, khách hẹn tuần sau',
            contactChannel: 'CALL',
            contactResultId,
            nextAction: {
              suggestion: 'Gọi lại thứ Hai',
              dueAt: '2026-11-02T02:00:00.000Z',
            },
          },
          { 'x-idempotency-key': key },
        );
      const first = await send();
      expect(first.status).toBe(201);
      logA = first.body.data.id;
      expect(first.body.data).toMatchObject({
        customerId: cl,
        author: { id: ids.staffA, displayName: 'staffA' },
        content: 'Gọi lần 1, khách hẹn tuần sau',
        contactChannel: 'CALL',
        contactResult: { id: contactResultId },
        nextAction: {
          suggestion: 'Gọi lại thứ Hai',
          dueAt: '2026-11-02T02:00:00.000Z',
          appointmentId: null,
        },
        source: 'MANUAL',
        editedAt: null,
        canEdit: true,
        attachments: [],
      });

      const replay = await send();
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(logA);
      expect(
        await careLogs().countDocuments({ customerId: new Types.ObjectId(cl) }),
      ).toBe(1);

      const after = await customerDoc(cl);
      expect(after!.lastCareLogAt).toEqual(
        new Date(first.body.data.occurredAt),
      );
      expect(after!.__v).toBe(before!.__v);
      expect(after!.lastUpdatedAt.getTime()).toBeGreaterThanOrEqual(
        before!.lastUpdatedAt.getTime(),
      );
      expect(await auditOf(cl, 'CARE_LOG_CREATED')).toHaveLength(1);

      const old = new Date(Date.now() - 3 * 24 * HOUR).toISOString();
      const backdated = await call(
        'POST',
        `/crm/customers/${cl}/care-logs`,
        'staffB',
        {
          content: 'Nhập bù cuộc gặp 3 ngày trước',
          contactChannel: 'MEETING',
          occurredAt: old,
        },
      );
      expect(backdated.status).toBe(201);
      expect((await customerDoc(cl))!.lastCareLogAt).toEqual(
        new Date(first.body.data.occurredAt),
      );

      const future = await call(
        'POST',
        `/crm/customers/${cl}/care-logs`,
        'staffA',
        {
          content: 'Tương lai',
          contactChannel: 'CALL',
          occurredAt: new Date(Date.now() + HOUR).toISOString(),
        },
      );
      expect(future.status).toBe(400);
      expect(future.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('xác thực đầu vào: kết quả liên hệ không tồn tại, appointment (M5) chưa nhận, nội dung rỗng, kênh sai', async () => {
      const post = (body: unknown) =>
        call('POST', `/crm/customers/${cl}/care-logs`, 'staffA', body);
      const missing = await post({
        content: 'x',
        contactChannel: 'CALL',
        contactResultId: new Types.ObjectId().toHexString(),
      });
      expect(missing.status).toBe(400);
      expect(missing.body.details).toMatchObject({ field: 'contactResultId' });

      expect(
        (
          await post({
            content: 'x',
            contactChannel: 'CALL',
            nextAction: { appointment: { type: 'MEETING' } },
          })
        ).status,
      ).toBe(400);
      expect(
        (await post({ content: '   ', contactChannel: 'CALL' })).status,
      ).toBe(400);
      expect((await post({ content: 'x', contactChannel: 'FAX' })).status).toBe(
        400,
      );
      expect(
        await careLogs().countDocuments({ customerId: new Types.ObjectId(cl) }),
      ).toBe(2);
    });

    it('danh mục "kết quả liên hệ" đã được nhật ký dùng thì không xóa được (CrmUsageService đọc care_logs.contactResultId)', async () => {
      const res = await call(
        'DELETE',
        `/crm/contact-results/${contactResultId}`,
        'admin',
      );
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('CATALOG_IN_USE');
    });

    it('dòng thời gian: mới nhất trước, phân trang { data, meta }, lọc theo kênh/tác giả/ngày; ngoài phạm vi 404', async () => {
      const all = await call('GET', `/crm/customers/${cl}/care-logs`, 'staffB');
      expect(all.status).toBe(200);
      expect(all.body.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(all.body.data.map((log: any) => log.id)).toHaveLength(2);
      expect(all.body.data[0].id).toBe(logA);
      expect(all.body.data[0].canEdit).toBe(false); // staffB không phải tác giả

      const byChannel = await call(
        'GET',
        `/crm/customers/${cl}/care-logs?contactChannel=MEETING`,
        'staffA',
      );
      expect(byChannel.body.meta.total).toBe(1);
      const byAuthor = await call(
        'GET',
        `/crm/customers/${cl}/care-logs?authorId=${ids.staffA}`,
        'staffA',
      );
      expect(byAuthor.body.data.map((log: any) => log.id)).toEqual([logA]);
      // Ngày lọc tính theo giờ Việt Nam (UTC+7).
      const today = new Date(Date.now() + 7 * HOUR).toISOString().slice(0, 10);
      expect(
        (
          await call(
            'GET',
            `/crm/customers/${cl}/care-logs?from=${today}&to=${today}`,
            'staffA',
          )
        ).body.meta.total,
      ).toBe(1);
      expect(
        (await call('GET', `/crm/customers/${cl}/care-logs?limit=1`, 'staffA'))
          .body.meta.totalPages,
      ).toBe(2);

      expect(
        (await call('GET', `/crm/customers/${cl}/care-logs`, 'staffC')).status,
      ).toBe(404);
      expect(
        (await call('GET', `/crm/customers/${cl}/care-logs`, 'editor')).status,
      ).toBe(403);
    });

    it('sửa/xóa: tác giả trong 24 giờ, người khác 403, quá 24 giờ 403 CARE_LOG_EDIT_WINDOW_EXPIRED, Quản trị/Quản lý (trong phạm vi) mọi lúc', async () => {
      const edited = await call(
        'PATCH',
        `/crm/customers/${cl}/care-logs/${logA}`,
        'staffA',
        { content: 'Gọi lần 1 (đã chỉnh)' },
      );
      expect(edited.status).toBe(200);
      expect(edited.body.data.content).toBe('Gọi lần 1 (đã chỉnh)');
      expect(edited.body.data.editedAt).toEqual(expect.any(String));
      const [update] = (await auditOf(cl, 'CARE_LOG_UPDATED')).slice(-1);
      expect(update.changes[0]).toMatchObject({
        field: 'careLog.content',
        from: 'Gọi lần 1, khách hẹn tuần sau',
        to: 'Gọi lần 1 (đã chỉnh)',
      });

      const stranger = await call(
        'PATCH',
        `/crm/customers/${cl}/care-logs/${logA}`,
        'staffB',
        { content: 'Sửa trộm' },
      );
      expect(stranger.status).toBe(403);
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cl}/care-logs/${logA}`,
            'staffB',
          )
        ).status,
      ).toBe(403);

      await careLogs().updateOne(
        { _id: new Types.ObjectId(logA) },
        { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } },
      );
      for (const [method, body] of [
        ['PATCH', { content: 'Quá hạn' }],
        ['DELETE', undefined],
      ] as const) {
        const res = await call(
          method,
          `/crm/customers/${cl}/care-logs/${logA}`,
          'staffA',
          body,
        );
        expect([method, res.status, res.body.errorCode]).toEqual([
          method,
          403,
          'CARE_LOG_EDIT_WINDOW_EXPIRED',
        ]);
      }
      const asAdmin = await call(
        'PATCH',
        `/crm/customers/${cl}/care-logs/${logA}`,
        'admin',
        { content: 'Quản trị chỉnh', contactResultId: null },
      );
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body.data.contactResult).toBeNull();
      expect(asAdmin.body.data.canEdit).toBe(true);
      // Gỡ kết quả liên hệ => danh mục hết bị chặn xóa (không còn tham chiếu).
      expect(
        (
          await call(
            'DELETE',
            `/crm/contact-results/${contactResultId}`,
            'admin',
          )
        ).status,
      ).toBeLessThan(300);
    });

    it('xóa nhật ký mới nhất => lastCareLogAt lùi về nhật ký còn lại; xóa hết => null; có audit kèm lý do', async () => {
      const del = await call(
        'DELETE',
        `/crm/customers/${cl}/care-logs/${logA}?reason=Ghi nh%E1%BA%A7m`,
        'manager1',
      );
      expect(del.status).toBe(204);
      const remaining = await careLogs()
        .find({ customerId: new Types.ObjectId(cl), deletedAt: null })
        .toArray();
      expect(remaining).toHaveLength(1);
      expect((await customerDoc(cl))!.lastCareLogAt).toEqual(
        remaining[0].occurredAt,
      );
      const [audit] = await auditOf(cl, 'CARE_LOG_DELETED');
      expect(audit).toMatchObject({ reason: 'Ghi nhầm', actorRole: 'MANAGER' });

      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cl}/care-logs/${String(remaining[0]._id)}`,
            'admin',
          )
        ).status,
      ).toBe(204);
      expect((await customerDoc(cl))!.lastCareLogAt).toBeNull();
      expect(
        (await call('GET', `/crm/customers/${cl}/care-logs`, 'staffA')).body
          .meta.total,
      ).toBe(0);
      // Xóa lần nữa / sửa nhật ký đã xóa: không còn.
      expect(
        (
          await call(
            'PATCH',
            `/crm/customers/${cl}/care-logs/${logA}`,
            'admin',
            { content: 'x' },
          )
        ).status,
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Ảnh đính kèm nhật ký (MinIO giả trong bộ nhớ)', () => {
    let cp: string;
    const objectCount = () => storage.objects.size;

    beforeAll(async () => {
      ({ id: cp } = await createCustomer('staffA'));
      await call('POST', `/crm/customers/${cp}/care-team/members`, 'staffA', {
        userIds: [ids.staffB],
      });
    });

    it('tải ảnh: lưu theo tên UUID trong thư mục của khách, BỎ Exif/GPS, chỉ giữ tên gốc để hiển thị', async () => {
      const res = await upload(cp, 'staffA', {
        name: '../../etc/passwd.jpg',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'READY' });

      const stored = await attachmentsCol().findOne({
        _id: new Types.ObjectId(res.body.data.id),
      });
      expect(stored).toMatchObject({
        customerId: new Types.ObjectId(cp),
        uploaderId: new Types.ObjectId(ids.staffA),
        status: 'READY',
        careLogId: null,
        originalName: 'passwd.jpg',
        mimeType: 'image/jpeg',
      });
      expect(stored!.fileKey).toMatch(
        new RegExp(`^customers/${cp}/care-logs/[0-9a-f-]{36}\\.jpg$`),
      );
      const bytes = storage.objects.get(stored!.fileKey)!;
      expect(bytes.includes(Buffer.from('GPSLatitude'))).toBe(false);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(await auditOf(cp, 'ATTACHMENT_UPLOADED')).toHaveLength(1);
    });

    it('từ chối ảnh sai: sai MIME, nội dung không khớp định dạng, quá 5 MB, thiếu file, không phải multipart; không để lại file nào', async () => {
      const before = objectCount();
      const cases: Array<[string, Res, number, string | undefined]> = [
        [
          'text/plain',
          await upload(cp, 'staffA', { mime: 'text/plain' }),
          415,
          'ATTACHMENT_TYPE_INVALID',
        ],
        [
          'HTML giả JPEG',
          await upload(cp, 'staffA', {
            content: Buffer.from('<html><script>alert(1)</script></html>'),
          }),
          415,
          'ATTACHMENT_TYPE_INVALID',
        ],
        [
          'PNG khai báo nhưng là JPEG',
          await upload(cp, 'staffA', { mime: 'image/png' }),
          415,
          'ATTACHMENT_TYPE_INVALID',
        ],
        [
          'JPEG cụt',
          await upload(cp, 'staffA', {
            content: Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20]),
          }),
          415,
          'ATTACHMENT_TYPE_INVALID',
        ],
        [
          '> 5 MB',
          await upload(cp, 'staffA', { content: jpegWithGps(5 * 1024 * 1024) }),
          413,
          'FILE_TOO_LARGE',
        ],
        [
          'sai tên trường',
          await upload(cp, 'staffA', { field: 'photo' }),
          400,
          'VALIDATION_FAILED',
        ],
        [
          'không phải multipart',
          await call(
            'POST',
            `/crm/customers/${cp}/care-log-attachments`,
            'staffA',
            {},
          ),
          400,
          'VALIDATION_FAILED',
        ],
      ];
      for (const [label, res, statusCode, errorCode] of cases) {
        expect([label, res.status, res.body.errorCode]).toEqual([
          label,
          statusCode,
          errorCode,
        ]);
      }
      expect(objectCount()).toBe(before);
    });

    it('phạm vi và cờ: ngoài nhóm 404, EDITOR 403, tắt FEATURE_CRM_ATTACHMENTS => 404 (cả upload lẫn gắn ảnh vào nhật ký)', async () => {
      expect((await upload(cp, 'staffC')).status).toBe(404);
      expect((await upload(cp, 'editor')).status).toBe(403);

      process.env[ATTACHMENTS_FLAG] = 'false';
      try {
        expect((await upload(cp, 'staffA')).status).toBe(404);
        const withImage = await call(
          'POST',
          `/crm/customers/${cp}/care-logs`,
          'staffA',
          {
            content: 'x',
            contactChannel: 'CALL',
            attachmentIds: [new Types.ObjectId().toHexString()],
          },
        );
        expect(withImage.status).toBe(400);
      } finally {
        process.env[ATTACHMENTS_FLAG] = 'true';
      }
    });

    it('gắn ảnh vào ghi chú: chỉ ảnh của chính người ghi, đúng khách, chưa gắn nơi khác; ảnh gắn đúng một ghi chú; trả URL ký', async () => {
      const mineA = (await upload(cp, 'staffA')).body.data.id;
      const mineB = (await upload(cp, 'staffB')).body.data.id;
      const { id: otherCustomer } = await createCustomer('staffA');
      const foreign = (await upload(otherCustomer, 'staffA')).body.data.id;

      const post = (as: string, attachmentIds: string[]) =>
        call('POST', `/crm/customers/${cp}/care-logs`, as, {
          content: 'Có ảnh',
          contactChannel: 'SITE_VISIT',
          attachmentIds,
        });

      // Ảnh của người khác / của khách khác / không tồn tại: từ chối và không tạo nhật ký.
      const logsBefore = await careLogs().countDocuments({
        customerId: new Types.ObjectId(cp),
      });
      for (const [as, attachmentIds] of [
        ['staffA', [mineB]],
        ['staffA', [foreign]],
        ['staffA', [new Types.ObjectId().toHexString()]],
        ['staffA', [mineA, mineB]],
      ] as const) {
        const res = await post(as, [...attachmentIds]);
        expect([as, res.status, res.body.details?.field]).toEqual([
          as,
          400,
          'attachmentIds',
        ]);
      }
      expect(
        await careLogs().countDocuments({ customerId: new Types.ObjectId(cp) }),
      ).toBe(logsBefore);
      expect(
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(mineA) }))!
          .status,
      ).toBe('READY');

      const ok = await post('staffA', [mineA]);
      expect(ok.status).toBe(201);
      expect(ok.body.data.attachments).toHaveLength(1);
      expect(ok.body.data.attachments[0]).toMatchObject({
        id: mineA,
        mimeType: 'image/jpeg',
      });
      expect(ok.body.data.attachments[0].url).toMatch(
        /^https:\/\/fake-s3\.test\//,
      );
      expect(
        await attachmentsCol().findOne({ _id: new Types.ObjectId(mineA) }),
      ).toMatchObject({
        status: 'ATTACHED',
        careLogId: new Types.ObjectId(ok.body.data.id),
      });

      // Cùng ảnh không gắn được vào ghi chú thứ hai; hai ghi chú cùng lúc chỉ một bên nhận được.
      const reuse = await post('staffA', [mineA]);
      expect(reuse.status).toBe(400);

      const racers = await Promise.all(
        [1, 2].map(async () => ({
          id: (await upload(cp, 'staffA')).body.data.id,
        })),
      );
      const shared = racers[0].id;
      const raced = await Promise.all([
        post('staffA', [shared]),
        post('staffA', [shared]),
      ]);
      expect(raced.map((res) => res.status).sort()).toEqual([201, 400]);
      const owner = raced.find((res) => res.status === 201)!;
      expect(
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(shared) }))!
          .careLogId,
      ).toEqual(new Types.ObjectId(owner.body.data.id));

      // Danh sách trả lại URL ký cho ảnh đã gắn.
      const list = await call(
        'GET',
        `/crm/customers/${cp}/care-logs`,
        'staffB',
      );
      const withImage = list.body.data.find(
        (log: any) => log.id === ok.body.data.id,
      );
      expect(withImage.attachments[0].url).toMatch(
        /^https:\/\/fake-s3\.test\//,
      );
    });

    it('tối đa 5 ảnh/ghi chú (ATTACHMENT_LIMIT_EXCEEDED); sửa ghi chú thay tập ảnh: ảnh bị bỏ khỏi tập bị xóa khỏi kho', async () => {
      const six: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        six.push((await upload(cp, 'staffA')).body.data.id);
      }
      const tooMany = await call(
        'POST',
        `/crm/customers/${cp}/care-logs`,
        'staffA',
        {
          content: 'Quá nhiều ảnh',
          contactChannel: 'CALL',
          attachmentIds: six,
        },
      );
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.errorCode).toBe('ATTACHMENT_LIMIT_EXCEEDED');
      expect(tooMany.body.details).toEqual({ max: 5 });

      const created = await call(
        'POST',
        `/crm/customers/${cp}/care-logs`,
        'staffA',
        {
          content: 'Năm ảnh',
          contactChannel: 'CALL',
          attachmentIds: six.slice(0, 5),
        },
      );
      expect(created.status).toBe(201);
      const logId = created.body.data.id;
      const keyOf = async (id: string) =>
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(id) }))!
          .fileKey as string;
      const droppedKey = await keyOf(six[0]);
      expect(storage.objects.has(droppedKey)).toBe(true);

      const over = await call(
        'PATCH',
        `/crm/customers/${cp}/care-logs/${logId}`,
        'staffA',
        {
          attachmentIds: six,
        },
      );
      expect(over.status).toBe(400);
      expect(over.body.errorCode).toBe('ATTACHMENT_LIMIT_EXCEEDED');

      const swapped = await call(
        'PATCH',
        `/crm/customers/${cp}/care-logs/${logId}`,
        'staffA',
        {
          attachmentIds: [...six.slice(1, 5), six[5]],
        },
      );
      expect(swapped.status).toBe(200);
      expect(swapped.body.data.attachments.map((a: any) => a.id)).toEqual([
        ...six.slice(1, 5),
        six[5],
      ]);
      expect(storage.objects.has(droppedKey)).toBe(false);
      expect(
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(six[0]) }))!
          .status,
      ).toBe('REMOVED');
      expect(
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(six[5]) }))!
          .status,
      ).toBe('ATTACHED');

      // Xóa nhật ký => mọi ảnh của nó bị gỡ khỏi kho.
      const keys = await Promise.all(six.slice(1).map(keyOf));
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cp}/care-logs/${logId}`,
            'staffA',
          )
        ).status,
      ).toBe(204);
      for (const key of keys) expect(storage.objects.has(key)).toBe(false);
    });

    it('gỡ ảnh: chưa gắn => người tải lên (người khác 404); đã gắn => tác giả trong 24 giờ (người khác 403), nhật ký không còn ảnh', async () => {
      const loose = (await upload(cp, 'staffA')).body.data.id;
      const looseKey = (await attachmentsCol().findOne({
        _id: new Types.ObjectId(loose),
      }))!.fileKey;
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cp}/care-log-attachments/${loose}`,
            'staffB',
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cp}/care-log-attachments/${loose}`,
            'staffA',
          )
        ).status,
      ).toBe(204);
      expect(storage.objects.has(looseKey)).toBe(false);
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cp}/care-log-attachments/${loose}`,
            'staffA',
          )
        ).status,
      ).toBe(404);

      const attachedId = (await upload(cp, 'staffA')).body.data.id;
      const log = await call(
        'POST',
        `/crm/customers/${cp}/care-logs`,
        'staffA',
        {
          content: 'Ảnh sẽ bị gỡ',
          contactChannel: 'CALL',
          attachmentIds: [attachedId],
        },
      );
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cp}/care-log-attachments/${attachedId}`,
            'staffB',
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            'DELETE',
            `/crm/customers/${cp}/care-log-attachments/${attachedId}`,
            'staffA',
          )
        ).status,
      ).toBe(204);
      const reread = await careLogs().findOne({
        _id: new Types.ObjectId(log.body.data.id),
      });
      expect(reread!.attachments).toEqual([]);
      expect(await auditOf(cp, 'ATTACHMENT_REMOVED')).toHaveLength(2);
    });

    it('dọn nền: ảnh chưa gắn quá 24 giờ bị xóa khỏi kho; ảnh còn mới và ảnh đã gắn được giữ nguyên', async () => {
      const stale = (await upload(cp, 'staffA')).body.data.id;
      const fresh = (await upload(cp, 'staffA')).body.data.id;
      const keptId = (await upload(cp, 'staffA')).body.data.id;
      const kept = await call(
        'POST',
        `/crm/customers/${cp}/care-logs`,
        'staffA',
        {
          content: 'Giữ ảnh',
          contactChannel: 'CALL',
          attachmentIds: [keptId],
        },
      );
      expect(kept.status).toBe(201);
      const keyOf = async (id: string) =>
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(id) }))!
          .fileKey as string;
      const [staleKey, freshKey, keptKey] = await Promise.all(
        [stale, fresh, keptId].map(keyOf),
      );
      await attachmentsCol().updateMany(
        { _id: { $in: [stale, keptId].map((id) => new Types.ObjectId(id)) } },
        { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } },
      );

      const result = await app.get(AttachmentCleanupService).cleanup();

      expect(result.expired).toBeGreaterThanOrEqual(1);
      expect(storage.objects.has(staleKey)).toBe(false);
      expect(storage.objects.has(freshKey)).toBe(true);
      expect(storage.objects.has(keptKey)).toBe(true);
      expect(
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(stale) }))!,
      ).toMatchObject({
        status: 'REMOVED',
      });
      expect(
        (await attachmentsCol().findOne({ _id: new Types.ObjectId(keptId) }))!
          .status,
      ).toBe('ATTACHED');
      // Lần dọn thứ hai không còn gì để làm.
      expect(await app.get(AttachmentCleanupService).cleanup()).toEqual({
        expired: 0,
        purged: 0,
      });
    });

    it('giới hạn ảnh chưa gắn mỗi người trên mỗi khách (chống dồn rác vào kho)', async () => {
      const { id } = await createCustomer('staffD', {});
      let last: Res | undefined;
      for (let index = 0; index < 21; index += 1) {
        last = await upload(id, 'staffD');
        if (index < 20) expect(last.status).toBe(201);
      }
      expect(last!.status).toBe(400);
      expect(last!.body.errorCode).toBe('ATTACHMENT_LIMIT_EXCEEDED');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Ẩn danh hóa khách xóa dữ liệu chăm sóc', () => {
    it('ghi đè nội dung nhật ký + giá trị trong audit nhật ký, gỡ ảnh khỏi kho, xóa lời nhắn đề nghị tham gia', async () => {
      const { id } = await createCustomer('staffA', {
        fullName: 'Nguyễn Thị Bí Mật',
      });
      const imageId = (await upload(id, 'staffA')).body.data.id;
      const imageKey = (await attachmentsCol().findOne({
        _id: new Types.ObjectId(imageId),
      }))!.fileKey as string;
      const log = await call(
        'POST',
        `/crm/customers/${id}/care-logs`,
        'staffA',
        {
          content: 'Chị Bí Mật ở số 12 Lê Lợi, quan tâm căn 2PN',
          contactChannel: 'CALL',
          attachmentIds: [imageId],
          nextAction: { suggestion: 'Hẹn chị Bí Mật xem nhà' },
        },
      );
      expect(log.status).toBe(201);
      await call(
        'PATCH',
        `/crm/customers/${id}/care-logs/${log.body.data.id}`,
        'staffA',
        {
          content: 'Chị Bí Mật ở số 12 Lê Lợi, muốn căn 3PN',
        },
      );
      const request = await call('POST', '/crm/care-team-requests', 'staffC', {
        customerRef: id,
        message: 'Tôi quen chị Bí Mật',
      });
      expect(request.status).toBe(201);
      expect(storage.objects.has(imageKey)).toBe(true);

      const anonymized = await call(
        'POST',
        '/crm/customer-anonymizations',
        'admin',
        {
          customerId: id,
          reason: 'Khách yêu cầu xóa dữ liệu',
          confirm: true,
        },
      );
      expect(anonymized.status).toBe(201);

      const storedLog = await careLogs().findOne({
        _id: new Types.ObjectId(log.body.data.id),
      });
      expect(storedLog).toMatchObject({
        content: '[đã ẩn danh]',
        attachments: [],
        contactChannel: 'CALL',
      });
      expect(storedLog!.nextAction.suggestion).toBeNull();

      const storedImage = await attachmentsCol().findOne({
        _id: new Types.ObjectId(imageId),
      });
      expect(storedImage).toMatchObject({
        status: 'REMOVED',
        originalName: '',
      });

      const everyAudit = await auditOf(id);
      const careLogAudits = everyAudit.filter((row) =>
        String(row.action).startsWith('CARE_LOG_'),
      );
      expect(careLogAudits.length).toBeGreaterThanOrEqual(2);
      const serialized = JSON.stringify(everyAudit);
      expect(serialized).not.toContain('Bí Mật');
      expect(serialized).not.toContain('Lê Lợi');
      for (const row of careLogAudits) {
        for (const change of row.changes as Array<{
          field: string;
          from: unknown;
          to: unknown;
        }>) {
          if (
            ['careLog.content', 'careLog.nextAction.suggestion'].includes(
              change.field,
            )
          ) {
            expect([change.from, change.to]).toEqual([
              '[đã ẩn danh]',
              '[đã ẩn danh]',
            ]);
          }
        }
      }

      const storedRequest = await connection
        .collection('care_team_requests')
        .findOne({ _id: new Types.ObjectId(request.body.data.id) });
      expect(storedRequest).toMatchObject({
        message: null,
        status: 'CANCELED',
      });

      // File thật được dọn bởi job nền, không nằm trong transaction.
      await app.get(AttachmentCleanupService).cleanup();
      expect(storage.objects.has(imageKey)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Thao tác hàng loạt', () => {
    let b1: string; // staffA, nhóm A
    let b2: string; // staffA, nhóm A
    let b3: string; // staffC, nhóm B
    let bNoTeam: string; // admin, chưa có nhóm chăm sóc

    beforeAll(async () => {
      b1 = (await createCustomer('staffA')).id;
      b2 = (await createCustomer('staffA')).id;
      b3 = (await createCustomer('staffC')).id;
      bNoTeam = (await createCustomer('admin')).id;
    });

    const bulk = (
      as: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) => call('POST', '/crm/customer-bulk-operations', as, body, headers);

    it('đổi tình trạng: khách trong phạm vi đổi được, khách ngoài phạm vi/không tồn tại/đã xóa đều báo CUSTOMER_NOT_FOUND (không lộ)', async () => {
      const deleted = (await createCustomer('staffA')).id;
      expect(
        (await call('DELETE', `/crm/customers/${deleted}?reason=xoa`, 'admin'))
          .status,
      ).toBe(204);
      const ghost = new Types.ObjectId().toHexString();

      const res = await bulk('staffA', {
        type: 'CHANGE_STATUS',
        customerIds: [b1, b2, b3, ghost, deleted],
        payload: { statusId: status.INTERESTED },
      });

      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual([b1, b2]);
      expect(res.body.data.failed).toEqual([
        { customerId: b3, errorCode: 'CUSTOMER_NOT_FOUND' },
        { customerId: ghost, errorCode: 'CUSTOMER_NOT_FOUND' },
        { customerId: deleted, errorCode: 'CUSTOMER_NOT_FOUND' },
      ]);
      expect(String((await customerDoc(b1))!.statusId)).toBe(status.INTERESTED);
      expect(String((await customerDoc(b3))!.statusId)).not.toBe(
        status.INTERESTED,
      );
      const [audit] = await auditOf(b1, 'STATUS_CHANGED');
      expect(audit).toMatchObject({
        reason: 'Thao tác hàng loạt',
        actorRole: 'STAFF',
      });

      // Đổi sang đúng tình trạng hiện tại là no-op vẫn tính thành công; tình trạng không tồn tại báo từng khách.
      const same = await bulk('staffA', {
        type: 'CHANGE_STATUS',
        customerIds: [b1],
        payload: { statusId: status.INTERESTED },
      });
      expect(same.body.data.succeeded).toEqual([b1]);
      expect(await auditOf(b1, 'STATUS_CHANGED')).toHaveLength(1);
      const unknownStatus = await bulk('admin', {
        type: 'CHANGE_STATUS',
        customerIds: [b1],
        payload: { statusId: new Types.ObjectId().toHexString() },
      });
      expect(unknownStatus.body.data.failed).toEqual([
        { customerId: b1, errorCode: 'VALIDATION_FAILED' },
      ]);
    });

    it('phân người chăm sóc: Nhân viên 403; Quản lý chỉ trong phạm vi và nhóm mình quản lý; khách chưa có nhóm thiếu primaryUserId => PRIMARY_REQUIRED từng khách', async () => {
      const staff = await bulk('staffA', {
        type: 'ASSIGN',
        customerIds: [b1],
        payload: { memberIds: [ids.staffB] },
      });
      expect(staff.status).toBe(403);

      const res = await bulk('manager1', {
        type: 'ASSIGN',
        customerIds: [b1, b2, b3, bNoTeam],
        payload: { memberIds: [ids.staffB] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual([b1, b2]);
      expect(res.body.data.failed.map((f: any) => f.errorCode)).toEqual([
        'CUSTOMER_NOT_FOUND',
        'CUSTOMER_NOT_FOUND',
      ]);
      for (const id of [b1, b2]) {
        expect(
          ((await customerDoc(id))!.careTeam as any[])
            .map((m) => String(m.userId))
            .sort(),
        ).toEqual([ids.staffA, ids.staffB].sort());
        await expectCareTeamInvariant(id);
      }

      // Quản trị: khách chưa có nhóm cần primaryUserId; người đã có trong nhóm bị bỏ qua.
      const admin = await bulk('admin', {
        type: 'ASSIGN',
        customerIds: [b1, bNoTeam],
        payload: { memberIds: [ids.staffB] },
      });
      expect(admin.body.data.succeeded).toEqual([b1]);
      expect(admin.body.data.failed).toEqual([
        { customerId: bNoTeam, errorCode: 'PRIMARY_REQUIRED' },
      ]);

      const withPrimary = await bulk('admin', {
        type: 'ASSIGN',
        customerIds: [b1, bNoTeam],
        payload: { memberIds: [ids.staffC], primaryUserId: ids.staffB },
      });
      expect(withPrimary.body.data.succeeded).toEqual([b1, bNoTeam]);
      expect((await customerDoc(b1))!.primaryAssigneeId.toString()).toBe(
        ids.staffB,
      );
      expect((await customerDoc(bNoTeam))!.primaryAssigneeId.toString()).toBe(
        ids.staffB,
      );
      for (const id of [b1, bNoTeam]) {
        await expectCareTeamInvariant(id);
        await expectTeamIdsMatchMembers(id);
      }

      const invalid = await bulk('admin', {
        type: 'ASSIGN',
        customerIds: [b2],
        payload: { memberIds: [ids.blockedStaff] },
      });
      expect(invalid.body.data.failed).toEqual([
        { customerId: b2, errorCode: 'USER_NOT_ASSIGNABLE' },
      ]);
    });

    it('xác thực: tối đa 200 khách, id trùng/sai, thiếu payload, thẻ (M4) chưa khả dụng, EDITOR 403', async () => {
      const many = Array.from({ length: 201 }, () =>
        new Types.ObjectId().toHexString(),
      );
      const cases: Array<[string, unknown]> = [
        [
          '> 200',
          {
            type: 'CHANGE_STATUS',
            customerIds: many,
            payload: { statusId: status.NET },
          },
        ],
        [
          'rỗng',
          {
            type: 'CHANGE_STATUS',
            customerIds: [],
            payload: { statusId: status.NET },
          },
        ],
        [
          'id trùng',
          {
            type: 'CHANGE_STATUS',
            customerIds: [b1, b1],
            payload: { statusId: status.NET },
          },
        ],
        [
          'id sai',
          {
            type: 'CHANGE_STATUS',
            customerIds: ['abc'],
            payload: { statusId: status.NET },
          },
        ],
        [
          'thiếu statusId',
          { type: 'CHANGE_STATUS', customerIds: [b1], payload: {} },
        ],
        ['ASSIGN rỗng', { type: 'ASSIGN', customerIds: [b1], payload: {} }],
        [
          'thẻ',
          {
            type: 'ADD_TAGS',
            customerIds: [b1],
            payload: { tagIds: [new Types.ObjectId().toHexString()] },
          },
        ],
        ['loại lạ', { type: 'DELETE_ALL', customerIds: [b1], payload: {} }],
      ];
      for (const [label, body] of cases) {
        const res = await bulk('admin', body);
        expect([label, res.status]).toEqual([label, 400]);
      }
      expect(
        (
          await bulk('editor', {
            type: 'CHANGE_STATUS',
            customerIds: [b1],
            payload: { statusId: status.NET },
          })
        ).status,
      ).toBe(403);
    });

    it('Idempotency-Key: gửi lại cùng khóa trả lại kết quả cũ và không ghi thêm', async () => {
      const key = randomUUID();
      const body = {
        type: 'CHANGE_STATUS',
        customerIds: [b2],
        payload: { statusId: status.NET },
      };
      const first = await bulk('staffA', body, { 'x-idempotency-key': key });
      const replay = await bulk('staffA', body, { 'x-idempotency-key': key });
      expect(first.body).toEqual(replay.body);
      expect(first.body.data.succeeded).toEqual([b2]);
      expect(await auditOf(b2, 'STATUS_CHANGED')).toHaveLength(2);
    });
  });
});
