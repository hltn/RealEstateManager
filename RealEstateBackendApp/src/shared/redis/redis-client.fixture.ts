/**
 * Redis giả cho integration test KHÔNG dùng Redis (ví dụ chỉ import `NotificationsModule`, nơi `RedisModule` được
 * kéo theo): thay `REDIS_CLIENT` bằng đối tượng này để test không tự kết nối tới Redis của máy (dev/prod).
 * Có đủ phần `RedisModule.onApplicationShutdown` cần (`status`, `quit`, `disconnect`); lệnh `eval` trả 1 (cho phép).
 */
export const createRedisClientStub = () => ({
  status: 'ready',
  eval: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
});
