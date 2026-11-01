/**
 * INTEGRATION (qa-agent, review M0) — khóa chống double-submit của news-fire-crawl-manager
 * chạy trên IdempotencyService + Redis THẬT.
 *
 * Trước M0 `isInFlight` + `markInFlight` là đồng bộ nên không thể xen kẽ trong 1 process.
 * Sau M0 chúng là 2 lệnh Redis bất đồng bộ ⇒ hai request đến cùng lúc đều thấy "chưa chạy"
 * rồi cùng chiếm khóa (khe race). Controller đã đổi sang `tryMarkInFlight` (SET NX, nguyên tử)
 * nên test đồng thời dưới đây khóa hồi quy này.
 *
 * Cần Redis đang chạy (docker-compose.dev.yml). Chạy bằng `npm run test:integration`.
 */
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { RedisModule } from '../../shared/redis/redis.module';
import { NewsFireCrawlManagerController } from './news-fire-crawl-manager.controller';

// jsdom là ESM, Jest không parse được; controller không dùng tới trong test này (giống controller.spec.ts).
jest.mock('jsdom', () => ({}));

jest.setTimeout(30_000);

/** Mock "ôm hết": mọi thuộc tính truy cập đều là jest.fn() trả undefined. */
function autoMock<T extends object>(
  overrides: Record<string, unknown> = {},
): T {
  const cache: Record<string, unknown> = { ...overrides };
  return new Proxy(cache, {
    get: (target, prop: string) => (target[prop] ??= jest.fn()),
  }) as T;
}

describe('news-manager lock trên Redis thật', () => {
  let moduleRef: TestingModule;
  let idempotency: IdempotencyService;
  let createJob: jest.Mock;
  let releaseJob: () => void;
  let controller: NewsFireCrawlManagerController;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
              REDIS_KEY_PREFIX: `it-lock-${randomUUID().slice(0, 8)}:`,
            }),
          ],
        }),
        RedisModule,
      ],
      providers: [IdempotencyService],
    }).compile();
    await moduleRef.init();
    idempotency = moduleRef.get(IdempotencyService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await idempotency.clearInFlight('analyze-market-trends:global');
    let jobSeq = 0;
    createJob = jest.fn(() => `job-${++jobSeq}`);
    // Job nền treo đến khi test cho phép kết thúc, để khóa còn giữ trong lúc request thứ 2 đến.
    const jobDone = new Promise<void>((resolve) => (releaseJob = resolve));

    controller = new NewsFireCrawlManagerController(
      autoMock(),
      autoMock(),
      autoMock({ analyzeMarketTrendsByAI: () => jobDone.then(() => 'report') }),
      autoMock(),
      autoMock(),
      idempotency,
      autoMock(),
      autoMock({ createJob }),
    );
  });

  afterEach(async () => {
    releaseJob?.();
    // Đợi finally của job nền nhả khóa.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await idempotency.clearInFlight('analyze-market-trends:global');
  });

  it('tuần tự: request thứ 2 khi job đầu còn chạy bị 409 (hành vi cơ bản vẫn đúng)', async () => {
    await controller.analyzeMarketTrends({ ids: ['1'] });

    await expect(
      controller.analyzeMarketTrends({ ids: ['1'] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createJob).toHaveBeenCalledTimes(1);
  });

  it('nhả khóa sau khi job nền xong để request sau chạy được', async () => {
    await controller.analyzeMarketTrends({ ids: ['1'] });
    releaseJob();
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      idempotency.isInFlight('analyze-market-trends:global'),
    ).resolves.toBe(false);
  });

  // Hồi quy đã sửa: check-then-set không nguyên tử ⇒ double-click song song tạo 2 job.
  it('ĐỒNG THỜI: 2 request cùng lúc chỉ được 1 job, request còn lại 409', async () => {
    const results = await Promise.allSettled([
      controller.analyzeMarketTrends({ ids: ['1'] }),
      controller.analyzeMarketTrends({ ids: ['1'] }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(createJob).toHaveBeenCalledTimes(1);
  });

  it('chứng minh đúng nguyên nhân: tryMarkInFlight (SET NX) mới là nguyên tử', async () => {
    const results = await Promise.all([
      idempotency.tryMarkInFlight('analyze-market-trends:global'),
      idempotency.tryMarkInFlight('analyze-market-trends:global'),
    ]);

    expect(results.sort()).toEqual([false, true]);
  });
});
