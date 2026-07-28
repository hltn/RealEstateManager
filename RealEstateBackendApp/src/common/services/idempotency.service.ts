import { Injectable, OnModuleDestroy } from '@nestjs/common';

const TTL_MS = 5 * 60 * 1000;

interface IdempotencyEntry {
  response: unknown;
  expiresAt: number;
}

@Injectable()
export class IdempotencyService implements OnModuleDestroy {
  private readonly store = new Map<string, IdempotencyEntry>();
  private readonly inFlight = new Set<string>();
  private readonly timer: NodeJS.Timeout;

  constructor() {
    const timer = setInterval(() => this.purgeExpired(), TTL_MS);
    timer.unref(); // không giữ process sống nếu không còn request
    this.timer = timer;
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  get<T = unknown>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.response as T;
  }

  set(key: string, response: any): void {
    this.store.set(key, { response, expiresAt: Date.now() + TTL_MS });
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  markInFlight(key: string): void {
    this.inFlight.add(key);
  }

  clearInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}
