import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test dây thật của `load-env.ts` (side-effect module `main.ts` import đầu tiên): nạp `.env` rồi file cấu hình AI
 * đã lưu; file lưu THẮNG `.env`/compose cho 9 khóa allowlist, TRƯỚC khi DI khởi tạo.
 */
describe('load-env (nạp .env + file cấu hình AI lúc khởi động)', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let sandbox: string;
  let appDir: string;

  const runLoadEnv = (): void => {
    jest.isolateModules(() => {
      require('./load-env');
    });
  };

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'load-env-'));
    appDir = join(sandbox, 'repo', 'RealEstateBackendApp');
    mkdirSync(appDir, { recursive: true });
    process.chdir(appDir);
    for (const key of [
      'SETTINGS_CONFIG_FILE',
      'OPENROUTER_AI_MODEL',
      'OPENROUTER_API_KEY',
      'MUST1C_MODEL',
      'LOADENV_TEST_MONGO',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(sandbox, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('file lưu mặc định (.settings.env) thắng .env gần và ../.env cho khóa allowlist', () => {
    writeFileSync(
      join(sandbox, 'repo', '.env'),
      'OPENROUTER_AI_MODEL=from-root\n',
    );
    writeFileSync(
      join(appDir, '.env'),
      'OPENROUTER_AI_MODEL=from-env\nMUST1C_MODEL=env-must\n',
    );
    writeFileSync(
      join(appDir, '.settings.env'),
      "OPENROUTER_AI_MODEL='from-saved'\n",
    );

    runLoadEnv();

    expect(process.env.OPENROUTER_AI_MODEL).toBe('from-saved');
    expect(process.env.MUST1C_MODEL).toBe('env-must');
  });

  it('file lưu thắng cả biến đã có sẵn từ compose (process.env) cho khóa allowlist', () => {
    process.env.OPENROUTER_API_KEY = 'key-from-compose';
    writeFileSync(
      join(appDir, '.settings.env'),
      "OPENROUTER_API_KEY='key-saved'\n",
    );

    runLoadEnv();

    expect(process.env.OPENROUTER_API_KEY).toBe('key-saved');
  });

  it('SETTINGS_CONFIG_FILE chỉ tới file khác: dùng file đó, bỏ qua .settings.env mặc định', () => {
    const custom = join(sandbox, 'state', 'ai.env');
    mkdirSync(join(sandbox, 'state'), { recursive: true });
    writeFileSync(custom, "OPENROUTER_AI_MODEL='from-custom'\n");
    writeFileSync(
      join(appDir, '.settings.env'),
      "OPENROUTER_AI_MODEL='from-default'\n",
    );
    process.env.SETTINGS_CONFIG_FILE = custom;

    runLoadEnv();

    expect(process.env.OPENROUTER_AI_MODEL).toBe('from-custom');
  });

  it('khóa ngoài allowlist trong file lưu không vào process.env', () => {
    writeFileSync(join(appDir, '.env'), 'LOADENV_TEST_MONGO=mongodb://real\n');
    writeFileSync(
      join(appDir, '.settings.env'),
      "LOADENV_TEST_MONGO='mongodb://evil'\nOPENROUTER_AI_MODEL='ok'\n",
    );

    runLoadEnv();

    expect(process.env.LOADENV_TEST_MONGO).toBe('mongodb://real');
    expect(process.env.OPENROUTER_AI_MODEL).toBe('ok');
  });

  it('không có file lưu: giữ nguyên giá trị từ .env, không ném lỗi', () => {
    writeFileSync(join(appDir, '.env'), 'OPENROUTER_AI_MODEL=from-env\n');

    expect(runLoadEnv).not.toThrow();
    expect(process.env.OPENROUTER_AI_MODEL).toBe('from-env');
  });
});
