import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type AnalyzeJobStatus = 'pending' | 'done' | 'error';

export interface AnalyzeJob {
  status: AnalyzeJobStatus;
  // Kiểu kết quả tùy job: analyze-raw trả về mảng bài viết, market-trends trả về
  // markdown string. Generalize sang `unknown` để tái sử dụng chung 1 service cho mọi job.
  result?: unknown;
  error?: string;
  updatedAt: number;
}

const JOB_TTL_MS = 60 * 60 * 1000;

/**
 * Theo dõi trạng thái các job phân tích AI chạy nền (in-memory).
 * Chấp nhận mất job khi restart server — tính chất fire-and-forget của tác vụ này
 * không cần bền vững hơn thời gian sống của 1 lần deploy.
 */
@Injectable()
export class AnalyzeJobService {
  private jobs = new Map<string, AnalyzeJob>();

  createJob(): string {
    this.cleanupExpiredJobs();
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: 'pending', updatedAt: Date.now() });
    return jobId;
  }

  getJob(jobId: string): AnalyzeJob | undefined {
    return this.jobs.get(jobId);
  }

  markDone(jobId: string, result: unknown): void {
    this.jobs.set(jobId, { status: 'done', result, updatedAt: Date.now() });
  }

  markError(jobId: string, error: string): void {
    this.jobs.set(jobId, { status: 'error', error, updatedAt: Date.now() });
  }

  private cleanupExpiredJobs(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.updatedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }
}
