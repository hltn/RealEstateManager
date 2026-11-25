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
    const baseFilter = {
      kind: AttachmentKind.CARE_LOG_IMAGE,
      status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
      purgedAt: null,
      thumbKey: null,
    };

    it('FR-26: truy vấn 1 = thumbStatus NONE (dùng index một phần), cũ nhất trước, tối đa 200; truy vấn 2 = thiếu field, chỉ lấy phần lô còn thiếu', async () => {
      const { service, attachmentModel } = build();
      const first = chain([row('a.jpg'), row('b.jpg')]);
      const second = chain([]);
      attachmentModel.find
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);

      await service.backfillThumbnails();

      expect(THUMBNAIL_BACKFILL_BATCH_SIZE).toBe(200);
      expect(attachmentModel.find.mock.calls).toEqual([
        [{ ...baseFilter, thumbStatus: ThumbStatus.NONE }],
        [{ ...baseFilter, thumbStatus: { $exists: false } }],
      ]);
      expect(first.sort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(first.limit).toHaveBeenCalledWith(200);
      expect(second.sort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(second.limit).toHaveBeenCalledWith(198);
      // Không bao giờ dùng $ne (không suy ra được bộ lọc của index một phần).
      expect(JSON.stringify(attachmentModel.find.mock.calls)).not.toContain(
        '$ne',
      );
    });

    it('FR-26: truy vấn 1 đã đủ lô 200 thì KHÔNG chạy truy vấn 2', async () => {
      const { service, attachmentModel } = build();
      attachmentModel.find.mockReturnValue(
        chain(Array.from({ length: 200 }, (_, i) => row(`${i}.jpg`))),
      );

      await service.backfillThumbnails();

      expect(attachmentModel.find).toHaveBeenCalledTimes(1);
    });

    it('FR-26: xếp job thumbnail cho từng ảnh (NONE rồi thiếu field) và chỉ đếm ảnh được xếp mới', async () => {
      const { service, attachmentModel, thumbnailQueue } = build();
      const rows = [row('a.jpg'), row('b.jpg')];
      const legacy = [row('c.jpg')];
      attachmentModel.find
        .mockReturnValueOnce(chain(rows))
        .mockReturnValueOnce(chain(legacy));
      // Ảnh thứ hai không xếp được (đang có job chờ/chạy hoặc Redis lỗi): không tính, không dừng ảnh sau.
      thumbnailQueue.enqueue
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const queued = await service.backfillThumbnails();

      expect(thumbnailQueue.enqueue.mock.calls).toEqual(
        [...rows, ...legacy].map((item) => [String(item._id)]),
      );
      expect(queued).toBe(2);
    });

    it('FR-26: không còn ảnh nào cần bù thì không xếp job và trả 0 (lần chạy sau idempotent)', async () => {
      const { service, attachmentModel, thumbnailQueue } = build();
      attachmentModel.find.mockReturnValue(chain([]));

      expect(await service.backfillThumbnails()).toBe(0);
      expect(thumbnailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('FR-26: ảnh còn job đang chờ/chạy trong Redis (enqueue trả false) thì không được đếm là đã xếp', async () => {
      const { service, attachmentModel, thumbnailQueue } = build();
      attachmentModel.find
        .mockReturnValueOnce(chain([row('a.jpg'), row('b.jpg')]))
        .mockReturnValueOnce(chain([]));
      thumbnailQueue.enqueue.mockResolvedValue(false);

      expect(await service.backfillThumbnails()).toBe(0);
      expect(thumbnailQueue.enqueue).toHaveBeenCalledTimes(2);
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
