import { ConsoleLogger } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomLogger } from './custom-logger.service';
import { createAppFileLogger } from './winston.config';

/** Chờ điều kiện đúng bằng polling có timeout (thay cho setTimeout cố định). */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('CustomLogger + winston che PII (FR-15)', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    jest.restoreAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('FR-15 che message và tham số phụ chuỗi (stack) ở mọi level', () => {
    const logger = new CustomLogger();
    const levels = ['log', 'error', 'warn', 'debug', 'verbose'] as const;
    for (const level of levels) {
      const spy = jest
        .spyOn(ConsoleLogger.prototype, level)
        .mockImplementation(() => undefined);
      logger[level]('khách 0901234567', 'stack: a@b.com 079123456789', 42);
      const args = spy.mock.calls[0];
      expect(args[0]).toContain('[PHONE]');
      expect(args[0]).not.toContain('0901234567');
      expect(args[1]).toBe('stack: [EMAIL] [NATIONAL_ID]');
      expect(args[2]).toBe(42);
    }
  });

  it('FR-15 tham số phụ là object/null/undefined giữ nguyên kiểu, log không mất', () => {
    const logger = new CustomLogger();
    const spy = jest
      .spyOn(ConsoleLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    const obj = { phone: '0901234567' };
    logger.error('lỗi', obj, null, undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(obj);
    expect(spy.mock.calls[0][2]).toBeNull();
    expect(spy.mock.calls[0][3]).toBeUndefined();
  });

  it('FR-15 che Error có cause và object JSON', () => {
    const logger = new CustomLogger();
    const spy = jest
      .spyOn(ConsoleLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    logger.error(
      new Error('ngoài 0901234567', { cause: new Error('gốc a@b.com') }),
    );
    logger.error({ phone: '0901234567' });
    expect(spy.mock.calls[0][0]).not.toMatch(/0901234567|a@b\.com/);
    expect(spy.mock.calls[1][0]).toContain('"phone":"[PHONE]"');
  });

  it('FR-15 lớp format winston che PII khi ghi file', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-'));
    const dir = tmpDir;
    const logger = createAppFileLogger({ level: 'info', logDir: dir });
    logger.info('khách 0901234567 mail a@b.com');
    const readLog = (): string => {
      const file = fs.readdirSync(dir).find((f) => f.startsWith('app-'));
      return file ? fs.readFileSync(path.join(dir, file), 'utf8') : '';
    };
    try {
      await waitFor(() => readLog().includes('[EMAIL]'));
      const content = readLog();
      expect(content).toContain('[PHONE]');
      expect(content).not.toMatch(/0901234567|a@b\.com/);
    } finally {
      logger.close();
    }
  });
});
