/**
 * CustomLogger unit spec — contract mục 3 (Ghi log: cấm console.log, dùng logger
 * tuỳ chỉnh prepend caller `[file:line]`).
 *
 * Lưu ý kỹ thuật: `getCallerInfo` duyệt stack và bỏ qua frame có basename
 * `startsWith('custom-logger.service')`. Bản thân file spec này có basename
 * `custom-logger.service.spec.ts` → cũng khớp filter → caller frame của test
 * bị bỏ qua, prefix rỗng. Để test deterministic, override `global.Error` với
 * stack giả lập có caller frame `news.service.ts` (không khớp filter).
 */
import { ConsoleLogger } from '@nestjs/common';
import { CustomLogger } from './custom-logger.service';

const RealError = global.Error;

/** Cài global.Error giả lập trả về stack cố định cho `new Error().stack`. */
function withFakeStack(stack: string, fn: () => void): void {
  function FakeError(this: any, message?: string) {
    const e = new (RealError as any)(message);
    Object.defineProperty(e, 'stack', {
      value: stack,
      configurable: true,
      writable: true,
    });
    return e;
  }
  FakeError.prototype = RealError.prototype;
  const saved = (global as any).Error;
  (global as any).Error = FakeError;
  try {
    fn();
  } finally {
    (global as any).Error = saved;
  }
}

// Stack giả lập: 3 frame nội bộ CustomLogger (bị filter) + 1 caller thật.
const CALLER_STACK = [
  'Error',
  '    at CustomLogger.getCallerInfo (D:\\app\\src\\common\\logger\\custom-logger.service.ts:26:24)',
  '    at CustomLogger.prependCallerInfo (D:\\app\\src\\common\\logger\\custom-logger.service.ts:75:24)',
  '    at CustomLogger.log (D:\\app\\src\\common\\logger\\custom-logger.service.ts:95:14)',
  '    at NewsService.process (D:\\app\\src\\modules\\news\\news.service.ts:42:9)',
].join('\n');

// Stack không có caller hợp lệ (toàn nội bộ / node_modules) → prefix rỗng.
const ALL_INTERNAL_STACK = [
  'Error',
  '    at CustomLogger.getCallerInfo (D:\\app\\src\\common\\logger\\custom-logger.service.ts:26:24)',
  '    at Object.<anonymous> (D:\\app\\node_modules\\jest-circus\\build\\runner.js:101:19)',
  '    at Object.<anonymous> (node:internal/process/execution:1:1)',
].join('\n');

const EXPECTED_PREFIX = '[news.service.ts:42] ';

describe('CustomLogger (contract mục 3 — no console.log)', () => {
  let logger: CustomLogger;
  let superLogSpy: jest.SpyInstance;
  let superErrorSpy: jest.SpyInstance;
  let superWarnSpy: jest.SpyInstance;
  let superDebugSpy: jest.SpyInstance;
  let superVerboseSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new CustomLogger();
    superLogSpy = jest
      .spyOn(ConsoleLogger.prototype, 'log')
      .mockImplementation(() => undefined);
    superErrorSpy = jest
      .spyOn(ConsoleLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    superWarnSpy = jest
      .spyOn(ConsoleLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    superDebugSpy = jest
      .spyOn(ConsoleLogger.prototype, 'debug')
      .mockImplementation(() => undefined);
    superVerboseSpy = jest
      .spyOn(ConsoleLogger.prototype, 'verbose')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('prependCallerInfo (qua super spy + fake stack)', () => {
    it('log(string) → super.log với prefix + message', () => {
      withFakeStack(CALLER_STACK, () => logger.log('hello world'));

      expect(superLogSpy).toHaveBeenCalledWith(EXPECTED_PREFIX + 'hello world');
    });

    it('log(object) → JSON.stringify kèm prefix', () => {
      withFakeStack(CALLER_STACK, () =>
        logger.log({ k: 'v', n: 42 }),
      );

      const msg = superLogSpy.mock.calls[0][0] as string;
      expect(msg).toBe(EXPECTED_PREFIX + '{"k":"v","n":42}');
    });

    it('log(array) → serialize JSON array kèm prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.log([1, 'two', { x: true }]));

      expect(superLogSpy.mock.calls[0][0]).toBe(
        EXPECTED_PREFIX + '[1,"two",{"x":true}]',
      );
    });

    it('log(object circular ref) → fallback "[Object]" kèm prefix (không throw)', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      withFakeStack(CALLER_STACK, () => logger.log(circular));

      expect(superLogSpy.mock.calls[0][0]).toBe(EXPECTED_PREFIX + '[Object]');
    });

    it('log(number) → String(number) kèm prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.log(123));
      expect(superLogSpy.mock.calls[0][0]).toBe(EXPECTED_PREFIX + '123');
    });

    it('log(null) → "null" kèm prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.log(null));
      expect(superLogSpy.mock.calls[0][0]).toBe(EXPECTED_PREFIX + 'null');
    });

    it('log(undefined) → "undefined" kèm prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.log(undefined));
      expect(superLogSpy.mock.calls[0][0]).toBe(
        EXPECTED_PREFIX + 'undefined',
      );
    });
  });

  describe('các method error/warn/debug/verbose cũng prepend caller', () => {
    it('error → super.error với prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.error('boom'));
      expect(superErrorSpy.mock.calls[0][0]).toBe(EXPECTED_PREFIX + 'boom');
    });

    it('warn → super.warn với prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.warn('careful'));
      expect(superWarnSpy.mock.calls[0][0]).toBe(EXPECTED_PREFIX + 'careful');
    });

    it('debug → super.debug với prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.debug('inspect'));
      expect(superDebugSpy.mock.calls[0][0]).toBe(EXPECTED_PREFIX + 'inspect');
    });

    it('verbose → super.verbose với prefix', () => {
      withFakeStack(CALLER_STACK, () => logger.verbose('chatter'));
      expect(superVerboseSpy.mock.calls[0][0]).toBe(
        EXPECTED_PREFIX + 'chatter',
      );
    });
  });

  describe('getCallerInfo — filter frame nội bộ', () => {
    it('caller frame đầu tiên (news.service.ts) được chọn → prefix có file:line', () => {
      let info = '';
      withFakeStack(CALLER_STACK, () => {
        info = (logger as any).getCallerInfo();
      });
      expect(info).toBe(EXPECTED_PREFIX);
    });

    it('frame node_modules bị bỏ qua (filter norm.includes("node_modules"))', () => {
      let info = '';
      withFakeStack(ALL_INTERNAL_STACK, () => {
        info = (logger as any).getCallerInfo();
      });
      expect(info).toBe('');
    });

    it('stack không có frame hợp lệ → trả "" (không throw)', () => {
      let info = '';
      withFakeStack('Error', () => {
        info = (logger as any).getCallerInfo();
      });
      expect(info).toBe('');
    });

    it('stack undefined (new Error().stack rỗng) → trả ""', () => {
      let info = '';
      withFakeStack(undefined as any, () => {
        info = (logger as any).getCallerInfo();
      });
      expect(info).toBe('');
    });

    it('caller file dạng .js (dist build) cũng được nhận diện basename', () => {
      const stack = [
        'Error',
        '    at CustomLogger.log (D:\\app\\dist\\common\\logger\\custom-logger.service.js:95:14)',
        '    at NewsService.process (D:\\app\\dist\\modules\\news\\news.service.js:42:9)',
      ].join('\n');
      let info = '';
      withFakeStack(stack, () => {
        info = (logger as any).getCallerInfo();
      });
      expect(info).toBe('[news.service.js:42] ');
    });
  });
});
