/**
 * INTEGRATION — hạ tầng nền tảng M0 chạy trên Redis + MinIO THẬT.
 *
 * Yêu cầu: `docker compose -f docker-compose.dev.yml up -d --wait` (Redis :6379, MinIO :9000,
 * bucket crm-attachments / crm-exports). Biến môi trường (có mặc định cho dev):
 * REDIS_URL, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_ATTACHMENTS, S3_BUCKET_EXPORTS.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { randomUUID } from 'crypto';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { IdempotencyService } from '../common/services/idempotency.service';
import { RedisHealthIndicator } from '../health-indicators/redis.health-indicator';
import { StorageHealthIndicator } from '../health-indicators/storage.health-indicator';
import { QueueModule } from './queue/queue.module';
import { QueuePingService } from './queue/queue-ping.service';
import { RedisModule } from './redis/redis.module';
import { REDIS_CLIENT } from './redis/redis.constants';
import {
  FILE_STORAGE,
  IFileStorage,
  StorageBucket,
} from './storage/file-storage.interface';
import { ATTACHMENT_IMAGE_POLICY } from './storage/file-validation';
import { StorageModule } from './storage/storage.module';

jest.setTimeout(60_000);

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('fake-jpeg-body'),
]);

describe('Nền tảng M0 trên hạ tầng thật', () => {
  let moduleRef: TestingModule;
  let redis: Redis;
  let storage: IFileStorage;
  // Prefix riêng mỗi lần chạy để không đụng dữ liệu dev.
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
              REDIS_KEY_PREFIX: `it-${runId}:`,
              S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
              S3_REGION: 'us-east-1',
              S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
              S3_SECRET_ACCESS_KEY:
                process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
              S3_FORCE_PATH_STYLE: 'true',
              S3_BUCKET_ATTACHMENTS:
                process.env.S3_BUCKET_ATTACHMENTS ?? 'crm-attachments',
              S3_BUCKET_EXPORTS: process.env.S3_BUCKET_EXPORTS ?? 'crm-exports',
            }),
          ],
        }),
        RedisModule,
        QueueModule,
        StorageModule,
      ],
      providers: [
        IdempotencyService,
        RedisHealthIndicator,
        StorageHealthIndicator,
        HealthIndicatorService,
      ],
    }).compile();
    await moduleRef.init();

    redis = moduleRef.get(REDIS_CLIENT);
    storage = moduleRef.get(FILE_STORAGE);
  });

  // Key idempotency tự hết hạn theo TTL (prefix riêng mỗi lần chạy) nên không cần dọn thủ công.
  afterAll(async () => {
    await moduleRef.close();
  });

  describe('Idempotency trên Redis', () => {
    it('hai instance service (giả lập 2 pod) dùng chung trạng thái', async () => {
      const podA = moduleRef.get(IdempotencyService);
      const podB = new IdempotencyService(redis, moduleRef.get(ConfigService));

      await podA.set('shared-key', { message: 'ok' });

      await expect(podB.get('shared-key')).resolves.toEqual({ message: 'ok' });
    });

    it('tryMarkInFlight nguyên tử: 20 request song song chỉ đúng 1 request giành được khóa', async () => {
      const service = moduleRef.get(IdempotencyService);

      const results = await Promise.all(
        Array.from({ length: 20 }, () => service.tryMarkInFlight('race-key')),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      await service.clearInFlight('race-key');
      await expect(service.tryMarkInFlight('race-key')).resolves.toBe(true);
    });

    it('khóa gắn bootId (script compare-and-delete chạy thật trên Redis): instance khác không nhả nhầm khóa, instance chủ nhả được', async () => {
      const podA = moduleRef.get(IdempotencyService);
      const podB = new IdempotencyService(redis, moduleRef.get(ConfigService));
      await podA.tryMarkInFlight('owned-key');

      await podB.clearInFlight('owned-key');
      await expect(podA.isInFlight('owned-key')).resolves.toBe(true);

      await podA.clearInFlight('owned-key');
      await expect(podA.isInFlight('owned-key')).resolves.toBe(false);
    });

    it('tắt êm nhả các khóa instance đang giữ (job nền trong RAM sắp mất)', async () => {
      const pod = new IdempotencyService(redis, moduleRef.get(ConfigService));
      await pod.tryMarkInFlight('held-on-shutdown');

      await pod.beforeApplicationShutdown();

      await expect(pod.isInFlight('held-on-shutdown')).resolves.toBe(false);
    });

    it('TTL thật trên Redis: key response có PTTL trong khoảng 5 phút', async () => {
      const service = moduleRef.get(IdempotencyService);
      await service.set('ttl-key', { v: 1 });

      const pttl = await redis.pttl('idem:resp:ttl-key');

      expect(pttl).toBeGreaterThan(4 * 60 * 1000);
      expect(pttl).toBeLessThanOrEqual(5 * 60 * 1000);
    });
  });

  describe('BullMQ', () => {
    it('queue health-ping chạy end-to-end: job vào hàng đợi, worker xử lý, trả đúng nonce', async () => {
      const result = await moduleRef.get(QueuePingService).ping(10_000);

      expect(result.pong).toBe(true);
    });
  });

  describe('Health indicator', () => {
    it('Redis thật trả up', async () => {
      await expect(
        moduleRef.get(RedisHealthIndicator).isHealthy('redis'),
      ).resolves.toEqual({
        redis: { status: 'up' },
      });
    });

    it('MinIO thật với 2 bucket CRM trả up', async () => {
      await expect(
        moduleRef.get(StorageHealthIndicator).isHealthy('storage'),
      ).resolves.toEqual({
        storage: { status: 'up' },
      });
    });
  });

  describe('FileStorageService trên MinIO', () => {
    it('upload (tên UUID) → download đúng nội dung → presigned URL tải được → delete', async () => {
      const stored = await storage.upload({
        bucket: StorageBucket.ATTACHMENTS,
        body: JPEG,
        mimeType: 'image/jpeg',
        policy: ATTACHMENT_IMAGE_POLICY,
        prefix: `integration-test/${runId}/`,
      });
      expect(stored.key).toMatch(
        new RegExp(`^integration-test/${runId}/[0-9a-f-]{36}\\.jpg$`),
      );

      expect(
        await storage.download(StorageBucket.ATTACHMENTS, stored.key),
      ).toEqual(JPEG);

      const url = await storage.getPresignedDownloadUrl(
        StorageBucket.ATTACHMENTS,
        stored.key,
      );
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);

      await storage.delete(StorageBucket.ATTACHMENTS, stored.key);
      await expect(
        storage.download(StorageBucket.ATTACHMENTS, stored.key),
      ).rejects.toThrow();
    });

    it('presigned upload: PUT đúng loại/dung lượng thì được, sai dung lượng thì MinIO từ chối', async () => {
      const presigned = await storage.createPresignedUpload({
        bucket: StorageBucket.ATTACHMENTS,
        mimeType: 'image/jpeg',
        size: JPEG.length,
        policy: ATTACHMENT_IMAGE_POLICY,
        prefix: `integration-test/${runId}/`,
      });

      const ok = await fetch(presigned.url, {
        method: 'PUT',
        headers: presigned.headers,
        body: JPEG,
      });
      expect(ok.status).toBe(200);

      const tooBig = await fetch(presigned.url, {
        method: 'PUT',
        headers: {
          ...presigned.headers,
          'Content-Length': String(JPEG.length + 10),
        },
        body: Buffer.concat([JPEG, Buffer.alloc(10)]),
      });
      expect(tooBig.status).toBeGreaterThanOrEqual(400);

      await storage.delete(StorageBucket.ATTACHMENTS, presigned.key);
    });
  });
});
