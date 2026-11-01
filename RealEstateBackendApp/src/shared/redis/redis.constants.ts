/** Injection token cho ioredis client dùng chung (key-value: idempotency, cache...). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
