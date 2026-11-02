import { CLI_USAGE, runCli } from './cli-app';
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
});
