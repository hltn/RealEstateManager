/**
 * HealthController spec — probe Kubernetes/Docker.
 *
 * Dùng HealthCheckService THẬT của Terminus (chỉ mock các indicator phụ thuộc hạ tầng) để
 * kiểm tra đúng hành vi tổng hợp: tất cả up thì 200 'ok'; bất kỳ thành phần down thì 503.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './health-indicators/redis.health-indicator';
import { StorageHealthIndicator } from './health-indicators/storage.health-indicator';

const UP = (key: string) => Promise.resolve({ [key]: { status: 'up' } });
const DOWN = (key: string) =>
  Promise.resolve({ [key]: { status: 'down', message: 'x' } });

async function createController(overrides: {
  mongo?: jest.Mock;
  redis?: jest.Mock;
  storage?: jest.Mock;
}) {
  const mongo = overrides.mongo ?? jest.fn(UP);
  const redis = overrides.redis ?? jest.fn(UP);
  const storage = overrides.storage ?? jest.fn(UP);

  const module = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
      { provide: MongooseHealthIndicator, useValue: { pingCheck: mongo } },
      { provide: RedisHealthIndicator, useValue: { isHealthy: redis } },
      { provide: StorageHealthIndicator, useValue: { isHealthy: storage } },
    ],
  }).compile();

  return { controller: module.get(HealthController), mongo, redis, storage };
}

describe('HealthController', () => {
  it('liveness: ok và KHÔNG kiểm tra dependency nào (Mongo/Redis chết không làm restart pod)', async () => {
    const { controller, mongo, redis, storage } = await createController({});

    const result = await controller.checkLiveness();

    expect(result.status).toBe('ok');
    expect(mongo).not.toHaveBeenCalled();
    expect(redis).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it('readiness: kiểm cả Mongo, Redis và S3/MinIO, tất cả up thì ok', async () => {
    const { controller, mongo, redis, storage } = await createController({});

    const result = await controller.checkReadiness();

    expect(result.status).toBe('ok');
    expect(Object.keys(result.info ?? {}).sort()).toEqual([
      'database',
      'redis',
      'storage',
    ]);
    expect(mongo).toHaveBeenCalledWith(
      'database',
      expect.objectContaining({ timeout: 3000 }),
    );
    expect(redis).toHaveBeenCalledWith('redis');
    expect(storage).toHaveBeenCalledWith('storage');
  });

  it.each([
    ['Mongo', { mongo: jest.fn(() => DOWN('database')) }, 'database'],
    ['Redis', { redis: jest.fn(() => DOWN('redis')) }, 'redis'],
    ['S3/MinIO', { storage: jest.fn(() => DOWN('storage')) }, 'storage'],
  ])(
    'readiness: %s down thì 503 và chỉ rõ thành phần lỗi',
    async (_name, overrides, key) => {
      const { controller } = await createController(overrides);

      const error = await controller.checkReadiness().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const body = (error as ServiceUnavailableException).getResponse() as {
        error: Record<string, unknown>;
      };
      expect(Object.keys(body.error)).toEqual([key]);
    },
  );
});
