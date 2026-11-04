import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { buildBullPrefix, buildRedisOptions } from '../redis/redis.config';
import { HealthPingJobData, HealthPingResult } from './health-ping.processor';
import { QueueNames } from './queue.constants';

const DEFAULT_PING_TIMEOUT_MS = 3000;

/**
 * Chứng minh hàng đợi chạy end-to-end: đẩy 1 job vào `health-ping`, chờ worker xử lý xong
 * và kiểm tra nonce trả về. Dùng cho smoke test/chẩn đoán, KHÔNG gọi trong liveness/readiness
 * (mỗi lần gọi tạo 1 job).
 */
@Injectable()
export class QueuePingService implements OnModuleDestroy {
  private queueEvents?: QueueEvents;

  constructor(
    @InjectQueue(QueueNames.HEALTH_PING)
    private readonly queue: Queue<HealthPingJobData, HealthPingResult>,
    private readonly config: ConfigService,
  ) {}

  async ping(timeoutMs = DEFAULT_PING_TIMEOUT_MS): Promise<HealthPingResult> {
    const nonce = randomUUID();
    const queueEvents = this.getQueueEvents();
    await queueEvents.waitUntilReady();

    const job = await this.queue.add(
      'ping',
      { nonce },
      { attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    const result: HealthPingResult = await job.waitUntilFinished(
      queueEvents,
      timeoutMs,
    );

    if (result?.nonce !== nonce) {
      throw new Error('Kết quả ping hàng đợi không khớp nonce');
    }
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }

  private getQueueEvents(): QueueEvents {
    this.queueEvents ??= new QueueEvents(QueueNames.HEALTH_PING, {
      connection: buildRedisOptions(this.config),
      prefix: buildBullPrefix(this.config),
    });
    return this.queueEvents;
  }
}
