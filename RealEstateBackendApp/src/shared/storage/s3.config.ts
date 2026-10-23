import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

/** Mọi lệnh gọi S3 phải có timeout 5s và retry exponential backoff + jitter (guideline mục 2). */
const S3_TIMEOUT_MS = 5000;
const S3_MAX_ATTEMPTS = 3;

/**
 * Tạo S3Client dùng cho cả AWS S3 lẫn MinIO.
 * - `endpoint` rỗng thì dùng AWS S3 thật; có endpoint (MinIO) thường cần `forcePathStyle=true`.
 * - `maxAttempts` + retryMode `standard`: SDK tự retry với exponential backoff + jitter.
 * - Checksum `WHEN_REQUIRED`: tránh SDK tự thêm header checksum làm MinIO/presigned URL lỗi.
 * - Credentials để trống thì SDK dùng default provider chain (IAM role...).
 *
 * `endpointKey` cho phép tạo thêm client trỏ vào endpoint công khai (S3_PUBLIC_ENDPOINT)
 * chỉ để KÝ presigned URL khi host nội bộ (docker) khác host mà trình duyệt nhìn thấy.
 */
export function createS3Client(
  config: ConfigService,
  endpointKey: 'S3_ENDPOINT' | 'S3_PUBLIC_ENDPOINT' = 'S3_ENDPOINT',
): S3Client {
  const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
  const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
  const endpoint = config.get<string>(endpointKey)?.trim() || undefined;

  return new S3Client({
    region: config.get<string>('S3_REGION')?.trim() || 'us-east-1',
    endpoint,
    forcePathStyle:
      String(config.get('S3_FORCE_PATH_STYLE') ?? 'false').toLowerCase() ===
      'true',
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
    maxAttempts: S3_MAX_ATTEMPTS,
    retryMode: 'standard',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      connectionTimeout: S3_TIMEOUT_MS,
      requestTimeout: S3_TIMEOUT_MS,
    },
  });
}
