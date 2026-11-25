import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { StorageBucket } from '../../../shared/storage/file-storage.interface';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { CareLogLean } from './care-log.mapper';

const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

const build = () => {
  const attachmentModel = {
    find: jest.fn(),
    updateMany: jest.fn(() => exec({ modifiedCount: 1 })),
  };
  const storage = {
    getPresignedDownloadUrl: jest.fn((_bucket: string, key: string) =>
      Promise.resolve(`https://s3/${key}?sig=1`),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CareLogAttachmentsService(
    {} as never,
    attachmentModel as never,
    {} as never,
    storage as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, attachmentModel, storage };
};

interface SnapshotItem {
  attachmentId: Types.ObjectId;
  fileKey: string;
  thumbKey?: string | null;
}

const logWith = (attachments: SnapshotItem[]) =>
  ({ attachments }) as unknown as CareLogLean;

describe('CareLogAttachmentsService: thumbnail phần phục vụ và xóa (FR-26)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  describe('signUrls', () => {
    it('FR-26: ảnh có thumbKey được ký cả file gốc lẫn thumbnail; ảnh chưa có thumbKey chỉ ký file gốc (thumbUrl null)', async () => {
      const { service, storage } = build();
      const withThumb = new Types.ObjectId();
      const oldImage = new Types.ObjectId();

      const urls = await service.signUrls([
        logWith([
          { attachmentId: withThumb, fileKey: 'goc.jpg', thumbKey: 'nho.webp' },
          { attachmentId: oldImage, fileKey: 'cu.jpg', thumbKey: null },
        ]),
      ]);

      expect(urls.get(String(withThumb))).toEqual({
        url: 'https://s3/goc.jpg?sig=1',
        thumbUrl: 'https://s3/nho.webp?sig=1',
      });
      expect(urls.get(String(oldImage))).toEqual({
        url: 'https://s3/cu.jpg?sig=1',
        thumbUrl: null,
      });
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledTimes(3);
    });

    it('FR-26: bản chụp ảnh cũ trong nhật ký thiếu hẳn field thumbKey vẫn ký bình thường (thumbUrl null)', async () => {
      const { service } = build();
      const id = new Types.ObjectId();

      const urls = await service.signUrls([
        logWith([{ attachmentId: id, fileKey: 'cu.jpg' }]),
      ]);

      expect(urls.get(String(id))?.thumbUrl).toBeNull();
    });
  });

  describe('detachFromCareLog', () => {
    it('FR-26: trả khóa của cả file gốc và thumbnail để xóa sau khi commit', async () => {
      const { service, attachmentModel } = build();
      const rows = [
        { _id: new Types.ObjectId(), fileKey: 'a.jpg', thumbKey: 'a.webp' },
        { _id: new Types.ObjectId(), fileKey: 'b.jpg', thumbKey: null },
      ];
      const query = {
        select: jest.fn(() => query),
        session: jest.fn(() => query),
        lean: jest.fn(() => query),
        exec: jest.fn().mockResolvedValue(rows),
      };
      attachmentModel.find.mockReturnValue(query);

      const keys = await service.detachFromCareLog(
        new Types.ObjectId(),
        'ALL',
        new Types.ObjectId(),
        new Date(),
        {} as never,
      );

      expect(query.select).toHaveBeenCalledWith('fileKey thumbKey');
      expect(keys).toEqual(['a.jpg', 'a.webp', 'b.jpg']);
    });
  });

  describe('purgeFiles', () => {
    it('FR-26: xóa mọi khóa được giao (gốc + thumbnail) và ghi purgedAt cho ảnh đã xóa đủ file', async () => {
      const { service, attachmentModel, storage } = build();

      await service.purgeFiles(['a.jpg', 'a.webp']);

      expect(storage.delete.mock.calls).toEqual([
        [StorageBucket.ATTACHMENTS, 'a.jpg'],
        [StorageBucket.ATTACHMENTS, 'a.webp'],
      ]);
      expect(attachmentModel.updateMany).toHaveBeenCalledWith(
        {
          fileKey: { $in: ['a.jpg', 'a.webp'] },
          $or: [{ thumbKey: null }, { thumbKey: { $in: ['a.jpg', 'a.webp'] } }],
        },
        { $set: { purgedAt: expect.any(Date) } },
      );
    });

    it('FR-26: xóa thumbnail lỗi thì điều kiện ghi purgedAt không khớp ảnh đó (thumbKey của nó không nằm trong danh sách đã xóa)', async () => {
      const { service, attachmentModel, storage } = build();
      storage.delete.mockImplementation((_bucket: string, key: string) =>
        key === 'a.webp'
          ? Promise.reject(new Error('minio timeout'))
          : Promise.resolve(),
      );

      await service.purgeFiles(['a.jpg', 'a.webp']);

      const [filter] = attachmentModel.updateMany.mock.calls[0] as unknown as [
        { fileKey: { $in: string[] }; $or: unknown[] },
      ];
      expect(filter.fileKey.$in).toEqual(['a.jpg']);
      // Ảnh a có thumbKey 'a.webp' (chưa xóa) nên không khớp nhánh `thumbKey: null` cũng không khớp `$in: ['a.jpg']`.
      expect(filter.$or).toEqual([
        { thumbKey: null },
        { thumbKey: { $in: ['a.jpg'] } },
      ]);
    });

    it('FR-26: xóa lỗi hết thì không ghi purgedAt nào', async () => {
      const { service, attachmentModel, storage } = build();
      storage.delete.mockRejectedValue(new Error('minio timeout'));

      await service.purgeFiles(['a.jpg', 'a.webp']);

      expect(attachmentModel.updateMany).not.toHaveBeenCalled();
    });
  });
});
