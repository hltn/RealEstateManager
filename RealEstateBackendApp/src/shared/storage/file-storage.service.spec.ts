import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { FileStorageService } from './file-storage.service';
import { StorageBucket } from './file-storage.interface';
import { ATTACHMENT_IMAGE_POLICY } from './file-validation';
import { createS3Client } from './s3.config';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const UUID_KEY = /^customers\/c1\/[0-9a-f-]{36}\.jpg$/;

const BASE_ENV: Record<string, string> = {
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  S3_BUCKET_ATTACHMENTS: 'crm-attachments',
  S3_BUCKET_EXPORTS: 'crm-exports',
};

function createService(env: Record<string, string> = {}) {
  const config = {
    get: (key: string) => ({ ...BASE_ENV, ...env })[key],
  } as unknown as ConfigService;
  // Client thật chỉ để ký URL offline; `send` bị thay bằng mock nên không có kết nối mạng.
  const s3 = createS3Client(config);
  const send = jest
    .spyOn(s3, 'send')
    .mockResolvedValue({} as never) as unknown as jest.Mock;
  return { service: new FileStorageService(s3, s3, config), send, config };
}

const sentCommand = (send: jest.Mock, index = 0) => send.mock.calls[index][0];

describe('FileStorageService', () => {
  describe('upload', () => {
    it('đổi tên thành UUID (giữ prefix), ghi đúng bucket + ContentType, bỏ tên gốc của client', async () => {
      const { service, send } = createService();

      const stored = await service.upload({
        bucket: StorageBucket.ATTACHMENTS,
        body: JPEG,
        mimeType: 'image/jpeg',
        policy: ATTACHMENT_IMAGE_POLICY,
        prefix: 'customers/c1/',
      });

      expect(stored.key).toMatch(UUID_KEY);
      expect(stored).toMatchObject({
        bucket: 'ATTACHMENTS',
        size: JPEG.length,
        mimeType: 'image/jpeg',
      });
      const command = sentCommand(send);
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'crm-attachments',
        Key: stored.key,
        ContentType: 'image/jpeg',
        ContentLength: JPEG.length,
      });
    });

    it('hai lần upload cùng nội dung cho hai key khác nhau', async () => {
      const { service } = createService();
      const input = {
        bucket: StorageBucket.ATTACHMENTS,
        body: JPEG,
        mimeType: 'image/jpeg',
        policy: ATTACHMENT_IMAGE_POLICY,
      };

      const [a, b] = await Promise.all([
        service.upload(input),
        service.upload(input),
      ]);

      expect(a.key).not.toBe(b.key);
    });

    it('file sai loại bị từ chối TRƯỚC khi chạm S3', async () => {
      const { service, send } = createService();

      await expect(
        service.upload({
          bucket: StorageBucket.ATTACHMENTS,
          body: Buffer.from('<html>'),
          mimeType: 'text/html',
          policy: ATTACHMENT_IMAGE_POLICY,
        }),
      ).rejects.toMatchObject({ errorCode: 'ATTACHMENT_TYPE_INVALID' });
      expect(send).not.toHaveBeenCalled();
    });

    it('bucket chưa cấu hình thì ném lỗi nêu rõ biến thiếu, không gọi S3', async () => {
      const { service, send } = createService({ S3_BUCKET_ATTACHMENTS: '' });

      await expect(
        service.upload({
          bucket: StorageBucket.ATTACHMENTS,
          body: JPEG,
          mimeType: 'image/jpeg',
          policy: ATTACHMENT_IMAGE_POLICY,
        }),
      ).rejects.toThrow('S3_BUCKET_ATTACHMENTS');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('presigned URL', () => {
    it('presigned download: ký cho đúng bucket/key, hết hạn mặc định 15 phút, host theo endpoint', async () => {
      const { service } = createService();

      const url = new URL(
        await service.getPresignedDownloadUrl(
          StorageBucket.ATTACHMENTS,
          'a/b.jpg',
        ),
      );

      expect(url.origin).toBe('http://127.0.0.1:9000');
      expect(url.pathname).toBe('/crm-attachments/a/b.jpg');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.search).not.toContain('test-secret-key');
    });

    it('S3_SIGNED_URL_TTL_SECONDS cấu hình được và bị chặn trần 1 giờ', async () => {
      const short = createService({ S3_SIGNED_URL_TTL_SECONDS: '60' }).service;
      const huge = createService({
        S3_SIGNED_URL_TTL_SECONDS: '999999',
      }).service;

      const shortUrl = new URL(
        await short.getPresignedDownloadUrl(StorageBucket.EXPORTS, 'x.csv'),
      );
      const hugeUrl = new URL(
        await huge.getPresignedDownloadUrl(StorageBucket.EXPORTS, 'x.csv'),
      );

      expect(shortUrl.searchParams.get('X-Amz-Expires')).toBe('60');
      expect(hugeUrl.searchParams.get('X-Amz-Expires')).toBe('3600');
    });

    it('presigned upload: ký cả content-type và content-length, trả header client phải gửi', async () => {
      const { service } = createService();

      const upload = await service.createPresignedUpload({
        bucket: StorageBucket.ATTACHMENTS,
        mimeType: 'image/jpeg',
        size: 1234,
        policy: ATTACHMENT_IMAGE_POLICY,
        prefix: 'customers/c1/',
      });

      const signedHeaders =
        new URL(upload.url).searchParams.get('X-Amz-SignedHeaders') ?? '';
      expect(signedHeaders.split(';')).toEqual(
        expect.arrayContaining(['content-type', 'content-length']),
      );
      expect(upload.key).toMatch(UUID_KEY);
      expect(upload.headers).toEqual({
        'Content-Type': 'image/jpeg',
        'Content-Length': '1234',
      });
      expect(upload.expiresInSeconds).toBe(900);
    });

    it('presigned upload từ chối dung lượng vượt giới hạn trước khi ký', async () => {
      const { service } = createService();

      await expect(
        service.createPresignedUpload({
          bucket: StorageBucket.ATTACHMENTS,
          mimeType: 'image/png',
          size: ATTACHMENT_IMAGE_POLICY.maxSizeBytes + 1,
          policy: ATTACHMENT_IMAGE_POLICY,
        }),
      ).rejects.toMatchObject({ errorCode: 'FILE_TOO_LARGE' });
    });

    it('S3_PUBLIC_ENDPOINT: URL ký bằng host công khai, còn API gọi qua endpoint nội bộ', async () => {
      const config = {
        get: (key: string) =>
          ({ ...BASE_ENV, S3_PUBLIC_ENDPOINT: 'https://files.example.com' })[
            key
          ],
      } as unknown as ConfigService;
      const internal = createS3Client(config);
      const send = jest.spyOn(internal, 'send').mockResolvedValue({} as never);
      const service = new FileStorageService(
        internal,
        createS3Client(config, 'S3_PUBLIC_ENDPOINT'),
        config,
      );

      const url = new URL(
        await service.getPresignedDownloadUrl(StorageBucket.EXPORTS, 'x.csv'),
      );
      await service.delete(StorageBucket.EXPORTS, 'x.csv');

      expect(url.origin).toBe('https://files.example.com');
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('khóa object nguy hiểm bị chặn TRƯỚC khi chạm S3', () => {
    const bad = '../crm-exports/secret.csv';

    it('download, delete và presigned download từ chối khóa path-traversal', async () => {
      const { service, send } = createService();

      await expect(
        service.download(StorageBucket.EXPORTS, bad),
      ).rejects.toThrow('Khóa object lưu trữ không hợp lệ');
      await expect(service.delete(StorageBucket.EXPORTS, bad)).rejects.toThrow(
        'Khóa object lưu trữ không hợp lệ',
      );
      await expect(
        service.getPresignedDownloadUrl(StorageBucket.EXPORTS, bad),
      ).rejects.toThrow('Khóa object lưu trữ không hợp lệ');
      expect(send).not.toHaveBeenCalled();
    });

    it.each(['../x/', 'customers/../x/', '/abs/', 'a b/', 'customers'])(
      'upload/presigned upload từ chối prefix không hợp lệ %p',
      async (prefix) => {
        const { service, send } = createService();
        const input = {
          bucket: StorageBucket.ATTACHMENTS,
          mimeType: 'image/jpeg',
          policy: ATTACHMENT_IMAGE_POLICY,
          prefix,
        };

        await expect(service.upload({ ...input, body: JPEG })).rejects.toThrow(
          /Prefix lưu trữ|Khóa object/,
        );
        await expect(
          service.createPresignedUpload({ ...input, size: JPEG.length }),
        ).rejects.toThrow(/Prefix lưu trữ|Khóa object/);
        expect(send).not.toHaveBeenCalled();
      },
    );
  });

  describe('download / delete', () => {
    it('download trả Buffer từ body của S3', async () => {
      const { service, send } = createService();
      send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(new Uint8Array([1, 2, 3])),
        },
      });

      const result = await service.download(StorageBucket.EXPORTS, 'x.csv');

      expect(result).toEqual(Buffer.from([1, 2, 3]));
      expect(sentCommand(send)).toBeInstanceOf(GetObjectCommand);
      expect(sentCommand(send).input).toMatchObject({
        Bucket: 'crm-exports',
        Key: 'x.csv',
      });
    });

    it('delete gửi DeleteObject đúng bucket/key', async () => {
      const { service, send } = createService();

      await service.delete(StorageBucket.ATTACHMENTS, 'a/b.jpg');

      expect(sentCommand(send)).toBeInstanceOf(DeleteObjectCommand);
      expect(sentCommand(send).input).toMatchObject({
        Bucket: 'crm-attachments',
        Key: 'a/b.jpg',
      });
    });
  });

  describe('checkHealth / isConfigured', () => {
    it('HeadBucket cho từng bucket đã cấu hình', async () => {
      const { service, send } = createService();

      await service.checkHealth();

      const buckets = send.mock.calls.map(([command]) => {
        expect(command).toBeInstanceOf(HeadBucketCommand);
        return command.input.Bucket;
      });
      expect(buckets.sort()).toEqual(['crm-attachments', 'crm-exports']);
    });

    it('một bucket lỗi thì checkHealth reject', async () => {
      const { service, send } = createService();
      send.mockRejectedValueOnce(new Error('NoSuchBucket'));

      await expect(service.checkHealth()).rejects.toThrow('NoSuchBucket');
    });

    it('chưa cấu hình bucket nào thì isConfigured=false và checkHealth reject', async () => {
      const { service } = createService({
        S3_BUCKET_ATTACHMENTS: '',
        S3_BUCKET_EXPORTS: '',
      });

      expect(service.isConfigured()).toBe(false);
      await expect(service.checkHealth()).rejects.toThrow(
        'Chưa cấu hình bucket S3',
      );
    });
  });
});

// Đảm bảo createS3Client dùng cho MinIO: path-style + endpoint tùy chỉnh.
describe('createS3Client', () => {
  it('MinIO: forcePathStyle + endpoint tùy chỉnh được áp dụng', async () => {
    const config = {
      get: (key: string) => BASE_ENV[key],
    } as unknown as ConfigService;
    const client: S3Client = createS3Client(config);

    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe('127.0.0.1');
    expect(endpoint?.port).toBe(9000);
    expect(client.config.forcePathStyle).toBe(true);
  });
});
