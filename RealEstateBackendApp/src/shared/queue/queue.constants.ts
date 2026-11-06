/** Tên các hàng đợi BullMQ — thêm hàng đợi nghiệp vụ mới tại đây để không rải chuỗi magic. */
export const QueueNames = {
  /** Hàng đợi kiểm tra sức khỏe: chứng minh Redis + BullMQ + worker chạy được. */
  HEALTH_PING: 'health-ping',
  /** Job lặp của CRM: nhịp 1 phút (nhắc việc, quét dịp đặc biệt/khách lâu chưa chăm sóc) và dọn ảnh đính kèm. */
  CRM_SCHEDULER: 'crm-scheduler',
  /** Gửi Web Push (job `push.send`, `push.sweep`). */
  PUSH: 'push',
  /** Xử lý ảnh đính kèm (job `attachment.thumbnail`, FR-26). */
  CRM_IMAGE: 'crm-image',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/** Job mặc định cho mọi queue: retry 3 lần, backoff mũ có jitter (chống nghẽn khi dependency hồi phục). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000, jitter: 0.5 },
  removeOnComplete: { age: 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/** Queue `push`: gọi dịch vụ push bên ngoài nên retry nhiều hơn (5 lần), backoff mũ gốc 5 giây, có jitter. */
export const PUSH_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000, jitter: 0.5 },
};

/** Job options riêng của từng queue (queue không có trong bảng dùng `DEFAULT_JOB_OPTIONS`). */
export const QUEUE_JOB_OPTIONS: Partial<
  Record<string, typeof DEFAULT_JOB_OPTIONS>
> = {
  [QueueNames.PUSH]: PUSH_JOB_OPTIONS,
};

/** Worker queue `push`: 5 job song song, tối đa 50 job/giây (không dồn dập vào dịch vụ push). */
export const PUSH_WORKER_OPTIONS = {
  concurrency: 5,
  limiter: { max: 50, duration: 1000 },
} as const;
