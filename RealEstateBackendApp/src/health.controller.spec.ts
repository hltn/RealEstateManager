/**
 * HealthController unit spec — contract mục 7.3 (Health Check / Terminus).
 *
 * Bao phủ 2 probe Kubernetes:
 * - GET /health/liveness  → gọi health.check([]) (không kiểm tra dependency).
 * - GET /health/readiness → gọi health.check([mongoose.pingCheck('database')]).
 *
 * Mock HealthCheckService và MongooseHealthIndicator để không chạm DB thật.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController (contract mục 7.3)', () => {
  let controller: HealthController;
  let health: jest.Mocked<HealthCheckService>;
  let mongoose: jest.Mocked<MongooseHealthIndicator>;

  beforeEach(async () => {
    health = {
      check: jest.fn(),
    } as unknown as jest.Mocked<HealthCheckService>;
    mongoose = {
      pingCheck: jest.fn(),
    } as unknown as jest.Mocked<MongooseHealthIndicator>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: MongooseHealthIndicator, useValue: mongoose },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('GET /health/liveness', () => {
    it('gọi health.check với mảng rỗng (không kiểm tra dependency)', async () => {
      const expected = { status: 'ok' };
      health.check.mockResolvedValue(expected);

      const result = await controller.checkLiveness();

      expect(health.check).toHaveBeenCalledWith([]);
      expect(result).toBe(expected);
    });

    it('propagate lỗi khi health.check throw (Terminus sẽ trả 503)', async () => {
      health.check.mockRejectedValue(new Error('service unavailable'));
      await expect(controller.checkLiveness()).rejects.toThrow(
        'service unavailable',
      );
    });
  });

  describe('GET /health/readiness', () => {
    it('gọi health.check với 1 indicator function wrap mongoose.pingCheck("database")', async () => {
      const indicatorResult = { database: { status: 'up' } };
      mongoose.pingCheck.mockResolvedValue(indicatorResult);
      let capturedIndicators: Array<() => Promise<unknown>> | undefined;
      health.check.mockImplementation(async (indicators) => {
        capturedIndicators = indicators;
        const result = await (indicators[0] as () => Promise<unknown>)();
        return { status: 'ok', info: result };
      });

      const result = await controller.checkReadiness();

      expect(capturedIndicators).toHaveLength(1);
      expect(mongoose.pingCheck).toHaveBeenCalledWith('database');
      expect(result).toEqual({ status: 'ok', info: indicatorResult });
    });

    it('DB chưa sẵn sàng (pingCheck reject) → propagate lỗi để terminus trả 503', async () => {
      mongoose.pingCheck.mockRejectedValue(new Error('db down'));
      health.check.mockImplementation(async (indicators) => {
        await (indicators[0] as () => Promise<unknown>)();
        return { status: 'ok' };
      });

      await expect(controller.checkReadiness()).rejects.toThrow('db down');
    });
  });
});
