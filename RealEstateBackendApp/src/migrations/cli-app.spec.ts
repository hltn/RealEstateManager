import {
  CLI_USAGE,
  CONNECTION_HINT,
  isConnectionError,
  runCli,
} from './cli-app';
import { EXIT_CODE } from './migration-runner';

const run = async (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    mongoUri: undefined,
    migrations: [],
    app: { version: '1.0.2', commit: null },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
};

describe('runCli (cú pháp, không cần kết nối Mongo)', () => {
  it('không có lệnh => mã 2 và in cách dùng', async () => {
    const { code, err } = await run([]);
    expect(code).toBe(EXIT_CODE.USAGE);
    expect(err.join('\n')).toContain('Cách dùng');
  });

  it('lệnh lạ (down không tồn tại) => mã 2', async () => {
    expect((await run(['down'])).code).toBe(EXIT_CODE.USAGE);
  });

  it('tùy chọn lạ => mã 2', async () => {
    expect((await run(['up', '--force'])).code).toBe(EXIT_CODE.USAGE);
  });

  it('--by sai giá trị => mã 2', async () => {
    expect((await run(['up', '--by', 'someone'])).code).toBe(EXIT_CODE.USAGE);
  });

  it('thiếu giá trị của --version => mã 2', async () => {
    expect((await run(['baseline', '--version'])).code).toBe(EXIT_CODE.USAGE);
  });

  it('--help => mã 0', async () => {
    const { code, out } = await run(['--help']);
    expect(code).toBe(EXIT_CODE.OK);
    expect(out[0]).toBe(CLI_USAGE);
  });

  it('thiếu MONGODB_URI => mã 1', async () => {
    const { code, err } = await run(['status']);
    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('')).toContain('MONGODB_URI');
  });

  it('reconcile nhận đủ cờ (--apply --by --skip-version --json): qua phân tích cú pháp, dừng ở thiếu MONGODB_URI (mã 1)', async () => {
    const { code, err } = await run([
      'reconcile',
      '--apply',
      '--by',
      'deploy',
      '--skip-version',
      '--json',
    ]);
    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('')).toContain('MONGODB_URI');
  });

  it('reconcile với tùy chọn lạ hoặc --by sai => mã 2', async () => {
    expect((await run(['reconcile', '--force'])).code).toBe(EXIT_CODE.USAGE);
    expect((await run(['reconcile', '--by', 'someone'])).code).toBe(
      EXIT_CODE.USAGE,
    );
  });

  it('FR-21: --phase nhận pre-up|post-up|all ở up và reconcile (qua cú pháp, dừng ở thiếu MONGODB_URI)', async () => {
    for (const command of ['up', 'reconcile']) {
      for (const phase of ['pre-up', 'post-up', 'all']) {
        const { code, err } = await run([command, '--phase', phase]);
        expect(code).toBe(EXIT_CODE.FAILURE);
        expect(err.join('')).toContain('MONGODB_URI');
      }
    }
  });

  it('FR-21: --phase sai giá trị hoặc thiếu giá trị => mã 2', async () => {
    expect((await run(['up', '--phase', 'later'])).code).toBe(EXIT_CODE.USAGE);
    expect((await run(['reconcile', '--phase', 'PRE-UP'])).code).toBe(
      EXIT_CODE.USAGE,
    );
    expect((await run(['reconcile', '--phase'])).code).toBe(EXIT_CODE.USAGE);
    expect((await run(['reconcile', '--phase', '--apply'])).code).toBe(
      EXIT_CODE.USAGE,
    );
  });

  it('FR-21: --phase ở lệnh không hỗ trợ (status, baseline, unlock) => mã 2', async () => {
    for (const command of ['status', 'baseline', 'unlock']) {
      const { code, err } = await run([command, '--phase', 'pre-up']);
      expect(code).toBe(EXIT_CODE.USAGE);
      expect(err.join('')).toContain('--phase chỉ dùng với up hoặc reconcile');
    }
  });

  it('FR-21: CLI_USAGE mô tả --phase và các giá trị pre-up, post-up, all', () => {
    expect(CLI_USAGE).toContain('--phase pre-up|post-up|all');
    expect(CLI_USAGE).toContain('--phase post-up trước');
  });

  it('mã thoát DOWNGRADE là 5 và cách dùng nêu reconcile + mã 5', () => {
    expect(EXIT_CODE.DOWNGRADE).toBe(5);
    expect(CLI_USAGE).toContain('reconcile');
    expect(CLI_USAGE).toContain('5 downgrade');
  });
});

describe('runCli (lỗi kết nối Mongo)', () => {
  it('Mongo không tới được (như standalone sai replicaSet): in LỖI + gợi ý replicaSet/xác thực, mã 1, KHÔNG lộ URI hay mật khẩu', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(['status'], {
      // Cổng 1 không có dịch vụ nào lắng nghe => lỗi chọn máy chủ sau hạn rút ngắn.
      mongoUri:
        'mongodb://admin:S3cretPass@127.0.0.1:1/realestate?replicaSet=rs0',
      migrations: [],
      app: { version: '1.0.3', commit: null },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      serverSelectionTimeoutMs: 300,
    });

    const stderr = err.join('\n');
    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(stderr).toContain('LỖI:');
    expect(stderr).toContain(CONNECTION_HINT);
    expect(stderr).not.toContain('S3cretPass');
    expect(stderr).not.toContain('mongodb://');
    expect(out).toEqual([]);
  });

  it('thiếu MONGODB_URI KHÔNG kèm gợi ý kết nối', async () => {
    const err: string[] = [];
    await runCli(['status'], {
      mongoUri: undefined,
      migrations: [],
      app: { version: '1.0.3', commit: null },
      out: () => undefined,
      err: (line) => err.push(line),
    });
    expect(err.join('')).not.toContain(CONNECTION_HINT);
  });
});

describe('isConnectionError', () => {
  const named = (name: string): Error =>
    Object.assign(new Error('x'), { name });
  const coded = (code: unknown): Error =>
    Object.assign(new Error('x'), { code });

  it.each([
    ['MongoServerSelectionError', named('MongoServerSelectionError'), true],
    ['MongoNetworkError', named('MongoNetworkError'), true],
    ['MongoNetworkTimeoutError', named('MongoNetworkTimeoutError'), true],
    ['Error có code 18 (AuthenticationFailed)', coded(18), true],
    ['Error có code khác (11000)', coded(11000), false],
    ['Error thường', new Error('boom'), false],
    ['TypeError', new TypeError('boom'), false],
    ['MongoServerError không phải xác thực', named('MongoServerError'), false],
    ['string', 'MongoServerSelectionError', false],
    ['undefined', undefined, false],
    ['null', null, false],
    ['object thường có code 18 (không phải Error)', { code: 18 }, false],
  ])('%s', (_label, error, expected) => {
    expect(isConnectionError(error)).toBe(expected);
  });
});
