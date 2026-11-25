import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import type { IFileStorage } from '../shared/storage/file-storage.interface';
import { RedisHealthIndicator } from './redis.health-indicator';
import { StorageHealthIndicator } from './storage.health-indicator';

/** HealthIndicatorService thật: kết quả `up/down` là dữ liệu thật, không cần mock. */
const indicatorService = new HealthIndicatorService();

describe('RedisHealthIndicator', () => {
  const create = (ping: jest.Mock) =>
    new RedisHealthIndicator(indicatorService, { ping } as unknown as Redis);

  it('PONG thì up', async () => {
    await expect(
      create(jest.fn().mockResolvedValue('PONG')).isHealthy('redis'),
    ).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('Redis lỗi thì down với thông báo chung, không lộ chi tiết lỗi gốc', async () => {
    const result = await create(
      jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:6379')),
    ).isHealthy('redis');

    expect(result).toEqual({
      redis: { status: 'down', message: 'Không kết nối được Redis' },
    });
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  it('phản hồi lạ (không phải PONG) thì down', async () => {
    const result = await create(
      jest.fn().mockResolvedValue('LOADING'),
    ).isHealthy('redis');
    expect(result.redis.status).toBe('down');
  });
});

describe('StorageHealthIndicator', () => {
  const create = (overrides: Partial<IFileStorage>) =>
    new StorageHealthIndicator(indicatorService, {
      isConfigured: () => true,
      checkHealth: () => Promise.resolve(),
      ...overrides,
    } as IFileStorage);

  it('bucket truy cập được thì up', async () => {
    await expect(create({}).isHealthy('storage')).resolves.toEqual({
      storage: { status: 'up' },
    });
  });

  it('chưa cấu hình S3 thì up kèm configured=false và KHÔNG gọi S3', async () => {
    const checkHealth = jest.fn();

    const result = await create({
      isConfigured: () => false,
      checkHealth,
    }).isHealthy('storage');

    expect(result).toEqual({ storage: { status: 'up', configured: false } });
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('S3 lỗi thì down', async () => {
    const result = await create({
      checkHealth: () => Promise.reject(new Error('AccessDenied')),
    }).isHealthy('storage');

    expect(result).toEqual({
      storage: { status: 'down', message: 'Không kết nối được S3/MinIO' },
    });
  });
});
