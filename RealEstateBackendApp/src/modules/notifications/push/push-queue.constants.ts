/** Tên job trong queue `push` (`QueueNames.PUSH`). */
export const PushJobNames = {
  /** Gửi push cho MỘT thông báo (`{ notificationId }`). */
  SEND: 'push.send',
  /** Job lặp quét thông báo `PENDING` bị sót (T-32). */
  SWEEP: 'push.sweep',
  /** Job lặp dọn subscription hết hạn/quá 90 ngày (T-29). */
  CLEANUP: 'push.cleanup',
} as const;

/**
 * `jobId` của job `push.send`: cùng thông báo thì cùng `jobId` nên BullMQ không xếp job thứ hai.
 * Dùng dấu `-` thay vì `:` như Architecture 5.2/5.3 ghi (`push:{id}`): BullMQ 6.x ném
 * `Custom Id cannot contain :` với `jobId` có đúng một dấu hai chấm.
 */
export const pushSendJobId = (notificationId: string): string =>
  `push-${notificationId}`;
