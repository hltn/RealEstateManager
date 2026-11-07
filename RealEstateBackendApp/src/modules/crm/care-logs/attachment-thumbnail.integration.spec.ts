/**
 * INTEGRATION — FR-26 thumbnail ảnh đính kèm: `CareLogAttachmentsService.upload` -> xếp job -> `AttachmentThumbnailProcessor`
 * trên MongoDB Replica Set thật (mongodb-memory-server, có transaction thật) với ảnh thật xử lý bằng `sharp`.
 * Kho ảnh là bản giả trong bộ nhớ (kiểm MIME/magic bytes thật như `FileStorageService`, có công tắc "kho lỗi") và hàng
 * đợi BullMQ là bản giả có hành vi `jobId` (đã có thì bỏ qua) + công tắc "Redis lỗi": không dùng Redis/MinIO/Docker.
 * Phần phục vụ (mapper, bù ảnh cũ, dọn kèm thumbKey) là T-54, không kiểm ở đây.
 *
 * Chạy: npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand attachment-thumbnail --forceExit
 */
import { randomUUID } from 'crypto';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import sharp from 'sharp';
import { UserRole } from '../../../common/enums/user-role.enum';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagService } from '../../../shared/feature-flags/feature-flag.service';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import {
  FILE_STORAGE,
  IFileStorage,
  StorageBucket,
  StoredFile,
  UploadFileInput,
} from '../../../shared/storage/file-storage.interface';
import {
  assertFileAllowed,
  extensionForMime,
} from '../../../shared/storage/file-validation';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CustomerAccessService } from '../customers/access/customer-access.service';
import { CustomersRepository } from '../customers/customers.repository';
import { AttachmentThumbnailProcessor } from './attachment-thumbnail.processor';
import { AttachmentThumbnailQueueService } from './attachment-thumbnail-queue.service';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { AttachmentStatus, ThumbStatus } from './care-log.constants';
import {
  CareLog,
  CareLogDocument,
  CareLogSchema,
} from './schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentDocument,
  CrmAttachmentSchema,
} from './schemas/crm-attachment.schema';
import { sampleImage } from './utils/thumbnail-test-images';

jest.setTimeout(300_000);

/** Kho ảnh giả trong bộ nhớ; `failDownload` mô phỏng MinIO lỗi mạng. */
class InMemoryFileStorage implements IFileStorage {
  readonly objects = new Map<string, Buffer>();
  failDownload = false;

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
    throw new Error('Không dùng');
  }
  getPresignedDownloadUrl(bucket: StorageBucket, key: string): Promise<string> {
    return Promise.resolve(`https://fake-s3.test/${bucket}/${key}?sig=1`);
  }
  download(_bucket: StorageBucket, key: string): Promise<Buffer> {
    if (this.failDownload) return Promise.reject(new Error('minio timeout'));
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

describe('FR-26 thumbnail ảnh đính kèm (tích hợp)', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let connection: Connection;
  let attachments: Model<CrmAttachmentDocument>;
  let careLogs: Model<CareLogDocument>;
  let service: CareLogAttachmentsService;
  let queue: AttachmentThumbnailQueueService;
  const storage = new InMemoryFileStorage();

  /** Hàng đợi giả: `jobId` đã có thì bỏ qua như BullMQ; `isRedisDown` mô phỏng Redis lỗi. */
  const jobs = new Map<
    string,
    { name: string; data: { attachmentId: string } }
  >();
  let isRedisDown = false;
  const runtime = {
    isEnabled: () => true,
    registerWorker: jest.fn(),
    add: jest.fn(
      (
        _queue: string,
        name: string,
        data: { attachmentId: string },
        options: { jobId: string },
      ) => {
        if (isRedisDown) return Promise.reject(new Error('redis down'));
        if (!jobs.has(options.jobId)) jobs.set(options.jobId, { name, data });
        return Promise.resolve({ id: options.jobId });
      },
    ),
  };

  const customerId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const jwt = { sub: String(userId) } as never;

  /** Upload ảnh thật qua service rồi trả `id` ảnh. */
  const upload = async (content: Buffer, mime = 'image/jpeg') => {
    const response = await service.upload(
      jwt,
      String(customerId),
      () =>
        Promise.resolve({
          buffer: content,
          mimeType: mime,
          originalName: 'anh.jpg',
        }),
      'web',
    );
    return response.id;
  };
  const findAttachment = (id: string) => attachments.findById(id).lean().exec();
  /** Chạy job đã xếp của một ảnh như worker (attemptsMade = số lần đã thử trước đó). */
  const runJob = (id: string, attemptsMade = 0) => {
    const job = jobs.get(`thumb-${id}`);
    if (!job) throw new Error(`Không có job thumbnail cho ảnh ${id}`);
    return queue.handle({
      name: job.name,
      data: job.data,
      attemptsMade,
      opts: { attempts: 3 },
    });
  };
  const thumbObjects = () =>
    [...storage.objects.keys()].filter((key) => key.endsWith('.webp'));

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        MongooseModule.forFeature([
          { name: CareLog.name, schema: CareLogSchema },
          { name: CrmAttachment.name, schema: CrmAttachmentSchema },
        ]),
      ],
      providers: [
        CareLogAttachmentsService,
        AttachmentThumbnailProcessor,
        AttachmentThumbnailQueueService,
        { provide: FILE_STORAGE, useValue: storage },
        { provide: QueueRuntimeService, useValue: runtime },
        { provide: FeatureFlagService, useValue: { isEnabled: () => true } },
        {
          provide: CustomerAccessService,
          useValue: {
            resolve: () =>
              Promise.resolve({
                scope: {},
                actor: { userId, role: UserRole.ADMIN },
              }),
          },
        },
        {
          provide: CustomersRepository,
          useValue: { findOne: () => Promise.resolve({ _id: customerId }) },
        },
        {
          provide: CrmRateLimitService,
          useValue: { consume: () => Promise.resolve() },
        },
        {
          provide: CrmAuditLogService,
          useValue: { record: () => Promise.resolve() },
        },
      ],
    }).compile();
    connection = moduleRef.get<Connection>(getConnectionToken());
    attachments = moduleRef.get(getModelToken(CrmAttachment.name));
    careLogs = moduleRef.get(getModelToken(CareLog.name));
    service = moduleRef.get(CareLogAttachmentsService);
    queue = moduleRef.get(AttachmentThumbnailQueueService);
    await attachments.init();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await replSet?.stop();
  });

  beforeEach(() => {
    jobs.clear();
    storage.objects.clear();
    storage.failDownload = false;
    isRedisDown = false;
    runtime.add.mockClear();
  });

  it('FR-26: upload trả ngay READY và xếp job; chạy job => thumbKey, thumbStatus READY, width/height gốc, thumbnail WebP <= 320px dưới tiền tố khách', async () => {
    const id = await upload(await sampleImage('jpeg', 1600, 800));

    // Upload KHÔNG chờ thumbnail: ảnh READY, chưa có thumbKey, job đã xếp đúng jobId.
    const before = await findAttachment(id);
    expect(before).toMatchObject({
      status: AttachmentStatus.READY,
      thumbKey: null,
      thumbStatus: ThumbStatus.NONE,
      thumbAttempts: 0,
    });
    expect([...jobs.keys()]).toEqual([`thumb-${id}`]);
    expect(runtime.add).toHaveBeenCalledWith(
      'crm-image',
      'attachment.thumbnail',
      { attachmentId: id },
      { jobId: `thumb-${id}` },
    );

    await runJob(id);

    const after = (await findAttachment(id))!;
    expect(after).toMatchObject({
      status: AttachmentStatus.READY,
      thumbStatus: ThumbStatus.READY,
      width: 1600,
      height: 800,
    });
    expect(after.thumbKey).toMatch(
      new RegExp(
        `^customers/${String(customerId)}/care-logs/[0-9a-f-]{36}\\.webp$`,
      ),
    );
    expect(after.thumbKey).not.toBe(after.fileKey);
    const thumb = storage.objects.get(after.thumbKey!)!;
    const meta = await sharp(thumb).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 320, 160]);
    expect(storage.objects.has(after.fileKey)).toBe(true); // ảnh gốc còn nguyên
  });

  it('FR-26: ảnh đã gắn vào nhật ký => bản chụp care_logs.attachments cũng nhận thumbKey/width/height (transaction 2 collection)', async () => {
    const id = await upload(await sampleImage('png', 640, 480), 'image/png');
    const careLogId = new Types.ObjectId();
    const snapshot = await connection.transaction((session) =>
      service.attachToCareLog(
        { userId, role: UserRole.ADMIN } as never,
        customerId,
        careLogId,
        [new Types.ObjectId(id)],
        session,
      ),
    );
    await careLogs.collection.insertOne({
      _id: careLogId,
      customerId,
      authorId: userId,
      attachments: snapshot,
    });
    expect(snapshot[0].thumbKey).toBeNull();

    await runJob(id);

    const att = (await findAttachment(id))!;
    const log = (await careLogs.collection.findOne({ _id: careLogId }))!;
    expect(att.status).toBe(AttachmentStatus.ATTACHED);
    expect(log.attachments[0]).toMatchObject({
      attachmentId: new Types.ObjectId(id),
      thumbKey: att.thumbKey,
      width: 640,
      height: 480,
    });
  });

  it('FR-26: ảnh gắn SAU khi đã có thumbnail => bản chụp lấy thumbKey ngay lúc gắn', async () => {
    const id = await upload(await sampleImage('jpeg', 500, 500));
    await runJob(id);
    const { thumbKey } = (await findAttachment(id))!;

    const snapshot = await connection.transaction((session) =>
      service.attachToCareLog(
        { userId, role: UserRole.ADMIN } as never,
        customerId,
        new Types.ObjectId(),
        [new Types.ObjectId(id)],
        session,
      ),
    );

    expect(snapshot[0]).toMatchObject({ thumbKey, width: 500, height: 500 });
  });

  it('FR-26: chạy job hai lần (retry/trùng) là idempotent: thumbKey không đổi, kho chỉ có MỘT thumbnail', async () => {
    const id = await upload(await sampleImage('jpeg', 900, 900));
    await runJob(id);
    const first = (await findAttachment(id))!.thumbKey;

    await runJob(id);

    expect((await findAttachment(id))!.thumbKey).toBe(first);
    expect(thumbObjects()).toEqual([first]);
  });

  it('FR-26: hai job chạy ĐỒNG THỜI cho một ảnh => đúng một thumbnail thắng, bản thua bị xóa khỏi kho', async () => {
    const id = await upload(await sampleImage('jpeg', 1200, 900));

    await Promise.all([runJob(id), runJob(id)]);

    const { thumbKey } = (await findAttachment(id))!;
    expect(thumbKey).not.toBeNull();
    expect(thumbObjects()).toEqual([thumbKey]);
  });

  it('FR-26: kho lỗi 3 lần => thumbStatus FAILED, thumbAttempts 3, ảnh vẫn READY và dùng được (thumbKey null)', async () => {
    const id = await upload(await sampleImage('jpeg', 800, 600));
    storage.failDownload = true;

    await expect(runJob(id, 0)).rejects.toThrow('minio timeout');
    expect(await findAttachment(id)).toMatchObject({
      thumbStatus: ThumbStatus.NONE,
      thumbAttempts: 1,
    });
    await expect(runJob(id, 1)).rejects.toThrow('minio timeout');
    expect(await findAttachment(id)).toMatchObject({
      thumbStatus: ThumbStatus.NONE,
      thumbAttempts: 2,
    });
    await expect(runJob(id, 2)).rejects.toThrow('minio timeout');

    const failed = (await findAttachment(id))!;
    expect(failed).toMatchObject({
      status: AttachmentStatus.READY,
      thumbStatus: ThumbStatus.FAILED,
      thumbAttempts: 3,
      thumbKey: null,
    });
    // Vẫn dùng được: URL ký của ảnh gốc cấp bình thường, file gốc còn, không có thumbnail.
    storage.failDownload = false;
    const urls = await service.signUrls([
      {
        attachments: [{ attachmentId: failed._id, fileKey: failed.fileKey }],
      } as never,
    ]);
    expect(urls.get(String(failed._id))).toContain(failed.fileKey);
    expect(storage.objects.has(failed.fileKey)).toBe(true);
    expect(thumbObjects()).toEqual([]);
  });

  it('FR-26: lỗi hạ tầng lần 1 rồi kho hồi phục => lần retry sau thành công, thumbStatus READY', async () => {
    const id = await upload(await sampleImage('jpeg', 800, 600));
    storage.failDownload = true;
    await expect(runJob(id, 0)).rejects.toThrow('minio timeout');
    storage.failDownload = false;

    await runJob(id, 1);

    expect(await findAttachment(id)).toMatchObject({
      thumbStatus: ThumbStatus.READY,
      thumbAttempts: 1,
    });
  });

  it('FR-26: ảnh gốc hỏng => FAILED ngay lần đầu, job không retry (UnrecoverableError), upload trước đó vẫn READY', async () => {
    const id = await upload(await sampleImage('jpeg', 400, 400));
    const original = (await findAttachment(id))!;
    // Hỏng nội dung đã lưu SAU upload (đĩa/kho hỏng): sharp không giải mã được.
    storage.objects.set(original.fileKey, Buffer.from('rac'));

    await expect(runJob(id, 0)).rejects.toThrow('THUMBNAIL_IMAGE_INVALID');

    expect(await findAttachment(id)).toMatchObject({
      status: AttachmentStatus.READY,
      thumbStatus: ThumbStatus.FAILED,
      thumbAttempts: 1,
      thumbKey: null,
    });
  });

  it('FR-26: ảnh bị gỡ (REMOVED) trước khi job chạy => bỏ qua, không tạo thumbnail mồ côi', async () => {
    const id = await upload(await sampleImage('jpeg', 400, 400));
    await attachments.updateOne(
      { _id: id },
      { $set: { status: AttachmentStatus.REMOVED } },
    );

    await runJob(id);

    expect((await findAttachment(id))!.thumbKey).toBeNull();
    expect(thumbObjects()).toEqual([]);
  });

  it('FR-26: ảnh bị gỡ GIỮA LÚC sharp đang xử lý => cập nhật có điều kiện không khớp, thumbnail vừa tải lên bị xóa', async () => {
    const id = await upload(await sampleImage('jpeg', 600, 600));
    // Gỡ ảnh ngay khi job tải ảnh gốc (sau bước kiểm trạng thái, trước bước cập nhật).
    const realDownload = storage.download.bind(storage);
    jest.spyOn(storage, 'download').mockImplementationOnce(async (b, k) => {
      const buffer = await realDownload(b, k);
      await attachments.updateOne(
        { _id: id },
        { $set: { status: AttachmentStatus.REMOVED } },
      );
      return buffer;
    });

    await runJob(id);

    expect((await findAttachment(id))!.thumbKey).toBeNull();
    expect(thumbObjects()).toEqual([]);
    jest.restoreAllMocks();
  });

  it('FR-26: Redis lỗi lúc xếp job => upload vẫn thành công READY (bù thumbnail sau), không file mồ côi', async () => {
    isRedisDown = true;

    const id = await upload(await sampleImage('jpeg', 400, 400));

    expect(await findAttachment(id)).toMatchObject({
      status: AttachmentStatus.READY,
      thumbKey: null,
    });
    expect(jobs.size).toBe(0);
    expect(storage.objects.size).toBe(1);
  });

  it('FR-26: upload xếp job SAU khi transaction commit: ảnh đã có trong DB lúc job được xếp', async () => {
    let wasPersistedAtEnqueue = false;
    runtime.add.mockImplementationOnce(
      async (
        _q: string,
        name: string,
        data: { attachmentId: string },
        o: { jobId: string },
      ) => {
        wasPersistedAtEnqueue =
          (await attachments.countDocuments({ _id: data.attachmentId })) === 1;
        jobs.set(o.jobId, { name, data });
        return { id: o.jobId };
      },
    );

    await upload(await sampleImage('jpeg', 400, 400));

    expect(wasPersistedAtEnqueue).toBe(true);
  });
});
