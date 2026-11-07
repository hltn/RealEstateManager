import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { StorageBucket } from '../../../shared/storage/file-storage.interface';
import {
  AttachmentCleanupService,
  THUMBNAIL_BACKFILL_BATCH_SIZE,
} from './attachment-cleanup.service';
import {
  AttachmentKind,
  AttachmentStatus,
  ThumbStatus,
} from './care-log.constants';

const row = (fileKey: string, thumbKey: string | null = null) => ({
  _id: new Types.ObjectId(),
  fileKey,
  thumbKey,
});

/** Chuỗi truy vấn Mongoose giả: mọi bước trả chính nó, `exec` trả `value`. */
const chain = <T>(value: T) => {
  const query = {
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    limit: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
};

const build = (options: { flagsOn?: boolean; configured?: boolean } = {}) => {
  const attachmentModel = {
    find: jest.fn(),
    updateMany: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    })),
  };
  const storage = {
    isConfigured: jest.fn(() => options.configured !== false),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const featureFlags = { isEnabled: jest.fn(() => options.flagsOn !== false) };
  const thumbnailQueue = { enqueue: jest.fn().mockResolvedValue(true) };
  const service = new AttachmentCleanupService(
    attachmentModel as never,
    storage as never,
    featureFlags as never,
    thumbnailQueue as never,
  );
  return { service, attachmentModel, storage, thumbnailQueue };
};

describe('AttachmentCleanupService (FR-26)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('backfillThumbnails (bù ảnh cũ)', () => {
    it('FR-26: chỉ chọn ảnh còn dùng, chưa xóa file, chưa có thumbKey, thumbStatus khác FAILED; cũ nhất trước, tối đa 200', async () => {
      const { service, attachmentModel } = build();
      const query = chain([]);
      attachmentModel.find.mockReturnValue(query);

      await service.backfillThumbnails();

      expect(THUMBNAIL_BACKFILL_BATCH_SIZE).toBe(200);
      expect(attachmentModel.find).toHaveBeenCalledWith({
        kind: AttachmentKind.CARE_LOG_IMAGE,
        status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
        purgedAt: null,
        thumbKey: null,
        thumbStatus: { $ne: ThumbStatus.FAILED },
      });
      expect(query.sort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(query.limit).toHaveBeenCalledWith(200);
    });

    it('FR-26: xếp job thumbnail cho từng ảnh tìm được và trả số ảnh xếp thành công', async () => {
      const { service, attachmentModel, thumbnailQueue } = build();
      const rows = [row('a.jpg'), row('b.jpg'), row('c.jpg')];
      attachmentModel.find.mockReturnValue(chain(rows));
      // Ảnh thứ hai xếp hàng thất bại (Redis lỗi): không tính, không dừng ảnh sau.
      thumbnailQueue.enqueue
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const queued = await service.backfillThumbnails();

      expect(thumbnailQueue.enqueue.mock.calls).toEqual(
        rows.map((item) => [String(item._id)]),
      );
      expect(queued).toBe(2);
    });

    it('FR-26: không còn ảnh nào cần bù thì không xếp job và trả 0 (lần chạy sau idempotent)', async () => {
      const { service, attachmentModel, thumbnailQueue } = build();
      attachmentModel.find.mockReturnValue(chain([]));

      expect(await service.backfillThumbnails()).toBe(0);
      expect(thumbnailQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('cleanup (dọn file kèm thumbnail)', () => {
    /** `find` lần đầu trả `rows`, các lần sau rỗng (hết việc). */
    const withRemoved = (
      attachmentModel: ReturnType<typeof build>['attachmentModel'],
      rows: ReturnType<typeof row>[],
    ) => {
      const query = chain(rows);
      query.exec.mockResolvedValueOnce(rows).mockResolvedValue([]);
      attachmentModel.find.mockReturnValue(query);
      return query;
    };

    it('FR-26: ảnh REMOVED có thumbKey thì xóa cả file gốc lẫn thumbnail rồi mới ghi purgedAt', async () => {
      const { service, attachmentModel, storage } = build();
      const withThumb = row('goc.jpg', 'nho.webp');
      const noThumb = row('goc2.jpg');
      const query = withRemoved(attachmentModel, [withThumb, noThumb]);

      const result = await service.cleanup();

      expect(query.select).toHaveBeenCalledWith('fileKey thumbKey');
      expect(storage.delete.mock.calls).toEqual([
        [StorageBucket.ATTACHMENTS, 'goc.jpg'],
        [StorageBucket.ATTACHMENTS, 'nho.webp'],
        [StorageBucket.ATTACHMENTS, 'goc2.jpg'],
      ]);
      expect(attachmentModel.updateMany).toHaveBeenLastCalledWith(
        { _id: { $in: [withThumb._id, noThumb._id] } },
        { $set: { purgedAt: expect.any(Date) } },
      );
      expect(result.purged).toBe(2);
    });

    it('FR-26: xóa thumbnail lỗi thì ảnh KHÔNG được ghi purgedAt (lần dọn sau xóa lại), ảnh khác vẫn xong', async () => {
      const { service, attachmentModel, storage } = build();
      const broken = row('goc.jpg', 'nho.webp');
      const fine = row('goc2.jpg', 'nho2.webp');
      withRemoved(attachmentModel, [broken, fine]);
      storage.delete.mockImplementation((_bucket: string, key: string) =>
        key === 'nho.webp'
          ? Promise.reject(new Error('minio timeout'))
          : Promise.resolve(),
      );

      const result = await service.cleanup();

      expect(attachmentModel.updateMany).toHaveBeenLastCalledWith(
        { _id: { $in: [fine._id] } },
        { $set: { purgedAt: expect.any(Date) } },
      );
      expect(result.purged).toBe(1);
    });
  });

  describe('runScheduled', () => {
    it('FR-26: cờ CRM/ảnh tắt hoặc kho chưa cấu hình thì không dọn và không bù', async () => {
      for (const options of [{ flagsOn: false }, { configured: false }]) {
        const { service, attachmentModel, thumbnailQueue } = build(options);
        await service.runScheduled();
        expect(attachmentModel.find).not.toHaveBeenCalled();
        expect(thumbnailQueue.enqueue).not.toHaveBeenCalled();
      }
    });

    it('FR-26: dọn lỗi vẫn chạy bước bù thumbnail, không ném lỗi ra job', async () => {
      const { service, attachmentModel, thumbnailQueue } = build();
      const pending = row('cu.jpg');
      attachmentModel.updateMany.mockImplementationOnce(() => ({
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      }));
      attachmentModel.find.mockReturnValue(chain([pending]));

      await expect(service.runScheduled()).resolves.toBeUndefined();

      expect(thumbnailQueue.enqueue).toHaveBeenCalledWith(String(pending._id));
    });

    it('FR-26: bù thumbnail lỗi không ném lỗi ra job (job lặp không bị dừng)', async () => {
      const { service, attachmentModel } = build();
      attachmentModel.find.mockImplementation(() => {
        throw new Error('mongo down');
      });

      await expect(service.runScheduled()).resolves.toBeUndefined();
    });
  });
});
