import { randomUUID } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePresignedUploadInput,
  IFileStorage,
  PresignedDownloadOptions,
  PresignedUpload,
  StorageBucket,
  StoredFile,
  UploadFileInput,
} from './file-storage.interface';
import {
  assertFileAllowed,
  assertSafeKey,
  extensionForMime,
  normalizeMime,
} from './file-validation';
import { S3_CLIENT, S3_PRESIGN_CLIENT } from './storage.constants';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_SIGNED_URL_TTL_SECONDS = 60 * 60;

const BUCKET_ENV_KEYS: Record<StorageBucket, string> = {
  [StorageBucket.ATTACHMENTS]: 'S3_BUCKET_ATTACHMENTS',
  [StorageBucket.EXPORTS]: 'S3_BUCKET_EXPORTS',
};

/**
 * Lưu trữ file trên S3/MinIO (backend stateless: file không nằm trên đĩa máy chủ).
 *
 * - Mọi file upload đều đổi tên thành UUID; MIME + dung lượng + magic bytes được kiểm trước khi gửi đi.
 * - Presigned URL mặc định sống 15 phút (`S3_SIGNED_URL_TTL_SECONDS`, tối đa 1 giờ).
 * - Bucket riêng tư: chỉ truy cập qua URL có chữ ký.
 * Nghiệp vụ nên inject token `FILE_STORAGE` (interface `IFileStorage`) để mock được khi test.
 */
@Injectable()
export class FileStorageService implements IFileStorage {
  private readonly signedUrlTtlSeconds: number;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_PRESIGN_CLIENT) private readonly presignClient: S3Client,
    private readonly config: ConfigService,
  ) {
    const ttl = Number(this.config.get('S3_SIGNED_URL_TTL_SECONDS'));
    this.signedUrlTtlSeconds =
      Number.isInteger(ttl) && ttl > 0
        ? Math.min(ttl, MAX_SIGNED_URL_TTL_SECONDS)
        : DEFAULT_SIGNED_URL_TTL_SECONDS;
  }

  async upload(input: UploadFileInput): Promise<StoredFile> {
    const mimeType = normalizeMime(input.mimeType);
    assertFileAllowed(input.policy, {
      mimeType,
      size: input.body.length,
      buffer: input.body,
    });

    const key = this.buildKey(mimeType, input.prefix);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.resolveBucket(input.bucket),
        Key: key,
        Body: input.body,
        ContentType: mimeType,
        ContentLength: input.body.length,
      }),
    );
    return { bucket: input.bucket, key, size: input.body.length, mimeType };
  }

  async createPresignedUpload(
    input: CreatePresignedUploadInput,
  ): Promise<PresignedUpload> {
    const mimeType = normalizeMime(input.mimeType);
    assertFileAllowed(input.policy, { mimeType, size: input.size });

    const key = this.buildKey(mimeType, input.prefix);
    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.resolveBucket(input.bucket),
        Key: key,
        ContentType: mimeType,
        ContentLength: input.size,
      }),
      {
        expiresIn: this.signedUrlTtlSeconds,
        // Ký cả content-type và content-length để S3 từ chối request sai loại/sai dung lượng.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      url,
      key,
      expiresInSeconds: this.signedUrlTtlSeconds,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(input.size),
      },
    };
  }

  async getPresignedDownloadUrl(
    bucket: StorageBucket,
    key: string,
    options: PresignedDownloadOptions = {},
  ): Promise<string> {
    assertSafeKey(key);
    const expiresIn = Math.min(
      options.expiresInSeconds ?? this.signedUrlTtlSeconds,
      MAX_SIGNED_URL_TTL_SECONDS,
    );
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.resolveBucket(bucket),
        Key: key,
        ResponseContentDisposition: options.downloadFileName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(options.downloadFileName)}`
          : undefined,
      }),
      { expiresIn },
    );
  }

  async download(bucket: StorageBucket, key: string): Promise<Buffer> {
    assertSafeKey(key);
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.resolveBucket(bucket), Key: key }),
    );
    if (!result.Body) throw new Error(`Object rỗng: ${bucket}/${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(bucket: StorageBucket, key: string): Promise<void> {
    assertSafeKey(key);
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.resolveBucket(bucket), Key: key }),
    );
  }

  /** HeadBucket cho mọi bucket đã cấu hình (readiness probe). Chưa cấu hình bucket nào thì ném lỗi. */
  async checkHealth(): Promise<void> {
    const buckets = this.configuredBuckets();
    if (buckets.length === 0) {
      throw new Error('Chưa cấu hình bucket S3 nào');
    }
    await Promise.all(
      buckets.map((Bucket) => this.s3.send(new HeadBucketCommand({ Bucket }))),
    );
  }

  /** Đã cấu hình ít nhất một bucket hay chưa (health dùng để quyết định có kiểm S3 không). */
  isConfigured(): boolean {
    return this.configuredBuckets().length > 0;
  }

  private configuredBuckets(): string[] {
    return Object.values(BUCKET_ENV_KEYS)
      .map((envKey) => this.config.get<string>(envKey)?.trim())
      .filter((name): name is string => !!name);
  }

  private resolveBucket(bucket: StorageBucket): string {
    const envKey = BUCKET_ENV_KEYS[bucket];
    const name = this.config.get<string>(envKey)?.trim();
    if (!name) throw new Error(`Chưa cấu hình ${envKey}`);
    return name;
  }

  /**
   * `<prefix><uuid>.<ext>`: ext suy ra từ MIME đã kiểm, không lấy từ tên file client.
   * Prefix (nếu có) phải kết thúc bằng `/` và toàn bộ key phải qua `assertSafeKey`.
   */
  private buildKey(mimeType: string, prefix = ''): string {
    if (prefix && !prefix.endsWith('/')) {
      throw new Error('Prefix lưu trữ phải kết thúc bằng dấu /');
    }
    const key = `${prefix}${randomUUID()}.${extensionForMime(mimeType)}`;
    assertSafeKey(key);
    return key;
  }
}
