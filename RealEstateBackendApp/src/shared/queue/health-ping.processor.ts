import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueNames } from './queue.constants';

export interface HealthPingJobData {
  nonce: string;
}

export interface HealthPingResult {
  pong: true;
  nonce: string;
}

/** Worker của hàng đợi health-ping: trả lại nonce để bên gọi xác nhận job đã đi hết vòng đời. */
@Processor(QueueNames.HEALTH_PING)
export class HealthPingProcessor extends WorkerHost {
  process(job: Job<HealthPingJobData>): Promise<HealthPingResult> {
    return Promise.resolve({ pong: true, nonce: job.data.nonce });
  }
}
