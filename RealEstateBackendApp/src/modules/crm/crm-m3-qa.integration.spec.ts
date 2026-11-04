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

  describe('Bất biến PRIMARY dưới tải đồng thời', () => {
    it('đổi chính / gỡ chính / thêm người song song: sau MỖI vòng đúng 1 PRIMARY, không trùng, primaryAssigneeId khớp, không 5xx', async () => {
      for (const key of ['qa1', 'qa2', 'qa3', 'qa4'])
        await createUser(key, UserRole.STAFF);
      for (let round = 0; round < 15; round += 1) {
        const c = await createCustomer('admin', {
          careTeam: { memberIds: [ids.qa2, ids.qa3], primaryUserId: ids.qa1 },
        });
        const results = await Promise.all([
          call('PUT', `/crm/customers/${c.id}/care-team/primary`, 'admin', {
            userId: ids.qa2,
          }),
          call('PUT', `/crm/customers/${c.id}/care-team/primary`, 'admin', {
            userId: ids.qa3,
          }),
          call(
            'DELETE',
            `/crm/customers/${c.id}/care-team/members/${ids.qa1}?newPrimaryUserId=${ids.qa4}`,
            'admin',
          ),
          addMembers('admin', c.id, [ids.qa4]),
        ]);
        expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
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

  describe('Phân công: người được phân phải hợp lệ cả khi đã nằm trong nhóm', () => {
    it('đổi phụ trách chính sang thành viên ĐÃ CÓ nhưng đã bị khóa => 400 USER_NOT_ASSIGNABLE', async () => {
      await createUser('qaBlocked', UserRole.STAFF);
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [ids.qaBlocked], primaryUserId: ids.qa5 },
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
      expect([res.status, res.body.errorCode]).toEqual([
        400,
        'USER_NOT_ASSIGNABLE',
      ]);
    });

    it('MANAGER không phân được người ngoài nhóm mình quản lý, kể cả qua bulk ASSIGN và qua duyệt', async () => {
      const c = await createCustomer('manager1', {});
      expect((await addMembers('manager1', c.id, [ids.staffC])).status).toBe(
        400,
      );
      const bulk = await call(
        'POST',
        '/crm/customer-bulk-operations',
        'manager1',
        {
          type: 'ASSIGN',
          customerIds: [c.id],
          payload: { memberIds: [ids.staffC], primaryUserId: ids.staffA },
        },
      );
      expect(bulk.body.data.failed.map((f: any) => f.errorCode)).toContain(
        'USER_NOT_ASSIGNABLE',
      );
      expect(
        (await customerDoc(c.id))!.careTeam.map((m: any) => String(m.userId)),
      ).not.toContain(ids.staffC);
    });
  });

  describe('Đề nghị tham gia', () => {
    it('trạng thái PENDING/lạ khi PATCH => 400; EDITOR 403; id đề nghị sai 400; người lạ hủy/duyệt 404', async () => {
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffC },
      });
      const created = await call('POST', '/crm/care-team-requests', 'staffA', {
        customerRef: c.id,
        message: 'Xin tham gia',
      });
      expect(created.status).toBe(201);
      const reqId = created.body.data.id;
      for (const status2 of ['PENDING', 'XYZ']) {
        expect(
          (
            await call('PATCH', `/crm/care-team-requests/${reqId}`, 'staffC', {
              status: status2,
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (
          await call('POST', '/crm/care-team-requests', 'editor', {
            customerRef: c.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('PATCH', '/crm/care-team-requests/zzz', 'staffC', {
            status: 'APPROVED',
          })
        ).status,
      ).toBe(400);
      for (const who of ['staffB', 'manager1']) {
        expect(
          (
            await call('PATCH', `/crm/care-team-requests/${reqId}`, who, {
              status: 'CANCELED',
            })
          ).status,
        ).toBe(404);
      }
      // người gửi (ngoài phạm vi) duyệt đề nghị của chính mình => 404 (không thấy khách)
      expect(
        (
          await call('PATCH', `/crm/care-team-requests/${reqId}`, 'staffA', {
            status: 'APPROVED',
          })
        ).status,
      ).toBe(404);
      // Quản lý trong phạm vi (quản lý nhóm A) nhưng chưa trong careTeam: gửi đề nghị rồi tự duyệt => 403
      const inA = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffB },
      });
      const mine = await call('POST', '/crm/care-team-requests', 'manager1', {
        customerRef: inA.id,
      });
      expect(mine.status).toBe(201);
      expect(
        (
          await call(
            'PATCH',
            `/crm/care-team-requests/${mine.body.data.id}`,
            'manager1',
            { status: 'APPROVED' },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            'PATCH',
            `/crm/care-team-requests/${mine.body.data.id}`,
            'staffB',
            { status: 'APPROVED' },
          )
        ).status,
      ).toBe(200);
    });

    it('duyệt khi người gửi đã bị khóa => 400, đề nghị vẫn PENDING và nhóm không đổi (transaction nguyên tử)', async () => {
      await createUser('qaReq', UserRole.STAFF);
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffC },
      });
      const created = await call('POST', '/crm/care-team-requests', 'qaReq', {
        customerRef: c.id,
      });
      await userModel.updateOne(
        { _id: ids.qaReq },
        { $set: { status: UserStatus.BLOCKED } },
      );
      const res = await call(
        'PATCH',
        `/crm/care-team-requests/${created.body.data.id}`,
        'staffC',
        { status: 'APPROVED' },
      );
      expect(res.status).toBe(400);
      expect(
        (await connection
          .collection('care_team_requests')
          .findOne({ _id: new Types.ObjectId(created.body.data.id) }))!.status,
      ).toBe('PENDING');
      expect((await customerDoc(c.id))!.careTeam).toHaveLength(1);
    });

    it('đề nghị cho khách đã xóa mềm / ẩn danh / id không phải khách => 404 như nhau (không phân biệt)', async () => {
      const c = await createCustomer('admin', {
        careTeam: { memberIds: [], primaryUserId: ids.staffC },
      });
      await call('DELETE', `/crm/customers/${c.id}?reason=t`, 'admin');
      const deleted = await call('POST', '/crm/care-team-requests', 'staffA', {
        customerRef: c.id,
      });
      const unknown = await call('POST', '/crm/care-team-requests', 'staffA', {
        customerRef: new Types.ObjectId().toHexString(),
      });
      expect([deleted.status, deleted.body.errorCode]).toEqual([
        unknown.status,
        unknown.body.errorCode,
      ]);
      expect(deleted.status).toBe(404);
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
      const req = await call('POST', '/crm/care-team-requests', 'staffC', {
        customerRef: c.id,
        message: `Tôi xin ${SECRET}`,
      });
      expect(req.status).toBe(201);
      await call(
        'PATCH',
        `/crm/care-team-requests/${req.body.data.id}`,
        'staffA',
        {
          status: 'REJECTED',
          resolutionNote: `Từ chối ${SECRET}`,
        },
      );
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
