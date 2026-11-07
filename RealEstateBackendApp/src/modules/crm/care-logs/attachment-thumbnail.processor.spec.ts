import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { StorageBucket } from '../../../shared/storage/file-storage.interface';
import { AttachmentThumbnailProcessor } from './attachment-thumbnail.processor';
import { AttachmentStatus, ThumbStatus } from './care-log.constants';
import { sampleImage } from './utils/thumbnail-test-images';

// `withTransaction` thật cần replica set: ở unit test chỉ chạy `work` với session giả (transaction thật ở integration test).
jest.mock('../../../shared/database/with-transaction.util', () => ({
  withTransaction: jest.fn((_connection, work) => work({ id: 'session' })),
}));

const ATTACHMENT_ID = new Types.ObjectId();
const CUSTOMER_ID = new Types.ObjectId();

const query = <T>(value: T) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

const build = (options: { found?: boolean; flags?: boolean } = {}) => {
  const attachmentModel = {
    findOne: jest.fn(() =>
      query(
        options.found === false
          ? null
          : {
              _id: ATTACHMENT_ID,
              customerId: CUSTOMER_ID,
              fileKey: 'customers/c/care-logs/goc.jpg',
            },
      ),
    ),
    updateOne: jest.fn<{ exec: jest.Mock }, unknown[]>(() => ({
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    })),
  };
  const careLogModel = {
    updateOne: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    })),
  };
  const storage = {
    isConfigured: jest.fn(() => true),
    download: jest.fn(),
    upload: jest.fn((input: { body: Buffer }) =>
      Promise.resolve({
        key: 'customers/c/care-logs/thumb.webp',
        size: input.body.length,
        mimeType: 'image/webp',
      }),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const featureFlags = { isEnabled: jest.fn(() => options.flags !== false) };
  const processor = new AttachmentThumbnailProcessor(
    {} as never,
    attachmentModel as never,
    careLogModel as never,
    storage as never,
    featureFlags as never,
  );
  return { processor, attachmentModel, careLogModel, storage, featureFlags };
};

const job = (attemptsMade = 0, attempts = 3) => ({
  data: { attachmentId: String(ATTACHMENT_ID) },
  attemptsMade,
  opts: { attempts },
});

describe('AttachmentThumbnailProcessor (FR-26)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('FR-26: ảnh thật => tải gốc, tải thumbnail WebP lên cùng bucket/tiền tố khách, cập nhật crm_attachments và bản chụp nhật ký', async () => {
    const { processor, attachmentModel, careLogModel, storage } = build();
    storage.download.mockResolvedValue(await sampleImage('jpeg', 1000, 500));

    const outcome = await processor.process(job());

    expect(outcome).toBe('CREATED');
    expect(storage.download).toHaveBeenCalledWith(
      StorageBucket.ATTACHMENTS,
      'customers/c/care-logs/goc.jpg',
    );
    const uploaded = storage.upload.mock.calls[0][0] as unknown as {
      bucket: StorageBucket;
      mimeType: string;
      prefix: string;
      body: Buffer;
    };
    expect(uploaded).toMatchObject({
      bucket: StorageBucket.ATTACHMENTS,
      mimeType: 'image/webp',
      prefix: `customers/${String(CUSTOMER_ID)}/care-logs/`,
    });
    expect((await sharp(uploaded.body).metadata()).width).toBe(320);
    // Cập nhật CÓ ĐIỀU KIỆN thumbKey: null (idempotent khi job chạy trùng).
    expect(attachmentModel.updateOne).toHaveBeenCalledWith(
      {
        _id: ATTACHMENT_ID,
        status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
        thumbKey: null,
      },
      {
        $set: {
          thumbKey: 'customers/c/care-logs/thumb.webp',
          thumbStatus: ThumbStatus.READY,
          width: 1000,
          height: 500,
        },
      },
      { session: { id: 'session' } },
    );
    expect(careLogModel.updateOne).toHaveBeenCalledWith(
      { 'attachments.attachmentId': ATTACHMENT_ID },
      {
        $set: {
          'attachments.$[img].thumbKey': 'customers/c/care-logs/thumb.webp',
          'attachments.$[img].width': 1000,
          'attachments.$[img].height': 500,
        },
      },
      {
        arrayFilters: [{ 'img.attachmentId': ATTACHMENT_ID }],
        session: { id: 'session' },
      },
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('FR-26: chỉ xử lý ảnh còn dùng, chưa dọn kho và chưa có thumbKey (điều kiện truy vấn)', async () => {
    const { processor, attachmentModel, storage } = build({ found: false });

    expect(await processor.process(job())).toBe('SKIPPED');

    expect(attachmentModel.findOne).toHaveBeenCalledWith({
      _id: ATTACHMENT_ID,
      status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
      purgedAt: null,
      thumbKey: null,
    });
    expect(storage.download).not.toHaveBeenCalled();
    expect(attachmentModel.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ['cờ CRM/ảnh đính kèm tắt', { flags: false }],
    ['kho lưu trữ chưa cấu hình', { configured: false }],
  ])('FR-26: %s => bỏ qua, không đụng DB hay kho', async (_label, extra) => {
    const { processor, attachmentModel, storage } = build(extra as never);
    if ('configured' in extra) storage.isConfigured.mockReturnValue(false);

    expect(await processor.process(job())).toBe('SKIPPED');

    expect(attachmentModel.findOne).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('FR-26: job thắng sau (thumbKey đã có / ảnh bị gỡ giữa chừng) => xóa thumbnail vừa tải lên, không để file mồ côi', async () => {
    const { processor, attachmentModel, careLogModel, storage } = build();
    storage.download.mockResolvedValue(await sampleImage('png', 400, 400));
    attachmentModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    });

    expect(await processor.process(job())).toBe('SKIPPED');

    expect(storage.delete).toHaveBeenCalledWith(
      StorageBucket.ATTACHMENTS,
      'customers/c/care-logs/thumb.webp',
    );
    expect(careLogModel.updateOne).not.toHaveBeenCalled();
  });

  it('FR-26: ghi DB lỗi => xóa thumbnail vừa tải lên, ghi nhận lần lỗi và ném lỗi để BullMQ retry', async () => {
    const { processor, attachmentModel, storage } = build();
    storage.download.mockResolvedValue(await sampleImage('png', 400, 400));
    attachmentModel.updateOne
      .mockReturnValueOnce({
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      })
      .mockReturnValue({
        exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      });

    await expect(processor.process(job(0))).rejects.toThrow('mongo down');

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(attachmentModel.updateOne).toHaveBeenLastCalledWith(
      { _id: ATTACHMENT_ID, thumbKey: null },
      { $inc: { thumbAttempts: 1 } },
    );
  });

  it('FR-26: lỗi tải gốc lần 1-2 => chỉ tăng thumbAttempts (chưa FAILED), lỗi gốc được ném lại', async () => {
    const { processor, attachmentModel, storage } = build();
    storage.download.mockRejectedValue(new Error('minio timeout'));

    for (const attemptsMade of [0, 1]) {
      await expect(processor.process(job(attemptsMade))).rejects.toThrow(
        'minio timeout',
      );
    }

    expect(attachmentModel.updateOne).toHaveBeenCalledTimes(2);
    for (const call of attachmentModel.updateOne.mock.calls) {
      expect(call[1]).toEqual({ $inc: { thumbAttempts: 1 } });
    }
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('FR-26: hết 3 lần (lần thứ 3) => thumbStatus = FAILED, vẫn ném lỗi để job ghi nhận thất bại', async () => {
    const { processor, attachmentModel, storage } = build();
    storage.download.mockRejectedValue(new Error('minio timeout'));

    await expect(processor.process(job(2, 3))).rejects.toThrow('minio timeout');

    expect(attachmentModel.updateOne).toHaveBeenCalledWith(
      { _id: ATTACHMENT_ID, thumbKey: null },
      {
        $inc: { thumbAttempts: 1 },
        $set: { thumbStatus: ThumbStatus.FAILED },
      },
    );
  });

  it('FR-26: job không có opts.attempts dùng mặc định 3 lần', async () => {
    const { processor, attachmentModel, storage } = build();
    storage.download.mockRejectedValue(new Error('x'));

    await expect(
      processor.process({
        data: { attachmentId: String(ATTACHMENT_ID) },
        attemptsMade: 2,
      }),
    ).rejects.toThrow('x');

    expect(attachmentModel.updateOne.mock.calls[0][1]).toMatchObject({
      $set: { thumbStatus: ThumbStatus.FAILED },
    });
  });

  it('FR-26: ảnh gốc hỏng (sharp không giải mã được) => FAILED ngay ở lần đầu và UnrecoverableError (không retry)', async () => {
    const { processor, attachmentModel, storage } = build();
    storage.download.mockResolvedValue(Buffer.from('khong phai anh'));

    await expect(processor.process(job(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(attachmentModel.updateOne).toHaveBeenCalledWith(
      { _id: ATTACHMENT_ID, thumbKey: null },
      {
        $inc: { thumbAttempts: 1 },
        $set: { thumbStatus: ThumbStatus.FAILED },
      },
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('FR-26: ghi nhận lỗi thất bại không che lỗi gốc của job', async () => {
    const { processor, attachmentModel, storage } = build();
    storage.download.mockRejectedValue(new Error('minio timeout'));
    attachmentModel.updateOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('mongo down')),
    });

    await expect(processor.process(job(2))).rejects.toThrow('minio timeout');
  });

  it.each([undefined, null, 123, '', 'khong-phai-objectid'])(
    'FR-26: job sai attachmentId (%p) => UnrecoverableError, không đụng DB',
    async (attachmentId) => {
      const { processor, attachmentModel } = build();

      await expect(
        processor.process({ data: { attachmentId }, attemptsMade: 0 }),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(attachmentModel.findOne).not.toHaveBeenCalled();
    },
  );
});
