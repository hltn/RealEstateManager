/** Tên các hàng đợi BullMQ — thêm hàng đợi nghiệp vụ mới tại đây để không rải chuỗi magic. */
export const QueueNames = {
  /** Hàng đợi kiểm tra sức khỏe: chứng minh Redis + BullMQ + worker chạy được. */
  HEALTH_PING: 'health-ping',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/** Job mặc định cho mọi queue: retry 3 lần, backoff mũ có jitter (chống nghẽn khi dependency hồi phục). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000, jitter: 0.5 },
  removeOnComplete: { age: 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};
