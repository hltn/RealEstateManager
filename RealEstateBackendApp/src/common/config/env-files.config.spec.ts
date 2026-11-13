import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_FILE_PATHS, EnvTarget, loadEnvFiles } from './env-files.config';

// Khóa riêng của test để không đụng biến thật của máy chạy.
const SHARED = 'ENVFILES_TEST_SHARED';
const ONLY_NEAR = 'ENVFILES_TEST_ONLY_NEAR';
const ONLY_ROOT = 'ENVFILES_TEST_ONLY_ROOT';
const TEST_KEYS = [SHARED, ONLY_NEAR, ONLY_ROOT];

describe('env-files.config', () => {
  let sandbox: string;
  let rootDir: string; // gốc repo (chứa `.env` dùng chung)
  let appDir: string; // thư mục chạy backend (chứa `.env` gần hơn)
  const originalCwd = process.cwd();

  const writeRoot = (content: string): void =>
    writeFileSync(join(rootDir, '.env'), content);
  const writeNear = (content: string): void =>
    writeFileSync(join(appDir, '.env'), content);

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'env-files-'));
    rootDir = join(sandbox, 'repo');
    appDir = join(rootDir, 'RealEstateBackendApp');
    mkdirSync(appDir, { recursive: true });
    process.chdir(appDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(sandbox, { recursive: true, force: true });
    for (const key of TEST_KEYS) delete process.env[key];
  });

  it('ENV_FILE_PATHS đúng đặc tả: .env gần trước, ../.env sau', () => {
    expect(ENV_FILE_PATHS).toEqual(['.env', '../.env']);
  });

  describe('loadEnvFiles', () => {
    it('gộp khóa của cả hai file; khóa trùng thì file gần (.env) thắng file gốc (../.env)', () => {
      writeRoot(`${SHARED}=from-root\n${ONLY_ROOT}=root-value\n`);
      writeNear(`${SHARED}=from-near\n${ONLY_NEAR}=near-value\n`);
      const target: EnvTarget = {};

      loadEnvFiles(target);

      expect(target).toEqual({
        [SHARED]: 'from-near',
        [ONLY_NEAR]: 'near-value',
        [ONLY_ROOT]: 'root-value',
      });
    });

    it('chỉ có ../.env ở gốc repo (chạy backend từ thư mục con) vẫn nạp được', () => {
      writeRoot(`${ONLY_ROOT}=root-value\n`);
      const target: EnvTarget = {};

      loadEnvFiles(target);

      expect(target).toEqual({ [ONLY_ROOT]: 'root-value' });
    });

    it('chỉ có .env gần: nạp bình thường', () => {
      writeNear(`${ONLY_NEAR}=near-value\n`);
      const target: EnvTarget = {};

      loadEnvFiles(target);

      expect(target).toEqual({ [ONLY_NEAR]: 'near-value' });
    });

    it('không có file nào (container): không ném lỗi, không thêm khóa nào', () => {
      const target: EnvTarget = { KEEP: 'x' };

      expect(() => loadEnvFiles(target)).not.toThrow();
      expect(target).toEqual({ KEEP: 'x' });
    });

    it('biến đã có sẵn (shell/compose) thắng cả hai file, kể cả khi giá trị là chuỗi rỗng', () => {
      writeNear(`${SHARED}=from-near\n${ONLY_NEAR}=near-value\n`);
      writeRoot(`${ONLY_ROOT}=root-value\n`);
      const target: EnvTarget = { [SHARED]: 'from-shell', [ONLY_ROOT]: '' };

      loadEnvFiles(target);

      expect(target[SHARED]).toBe('from-shell');
      expect(target[ONLY_ROOT]).toBe('');
      expect(target[ONLY_NEAR]).toBe('near-value');
    });

    it('khóa rỗng ở file gần (KEY=) vẫn che giá trị ở file gốc, không rơi xuống ../.env', () => {
      writeNear(`${SHARED}=\n`);
      writeRoot(`${SHARED}=from-root\n`);
      const target: EnvTarget = {};

      loadEnvFiles(target);

      expect(target[SHARED]).toBe('');
    });

    it('đọc được file CRLF (không dính ký tự \\r vào giá trị)', () => {
      writeRoot(`${ONLY_ROOT}=root-value\r\n${SHARED}=a\r\n`);
      const target: EnvTarget = {};

      loadEnvFiles(target);

      expect(target[ONLY_ROOT]).toBe('root-value');
      expect(target[SHARED]).toBe('a');
    });

    it('quiet: dotenv 17 không in dòng log "injected env" ra console (giữ sạch đầu ra status --json)', () => {
      writeNear(`${ONLY_NEAR}=near-value
`);
      const savedQuietEnv = process.env.DOTENV_CONFIG_QUIET;
      delete process.env.DOTENV_CONFIG_QUIET;
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        loadEnvFiles({});

        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
        if (savedQuietEnv !== undefined) {
          process.env.DOTENV_CONFIG_QUIET = savedQuietEnv;
        }
      }
    });

    it('mặc định ghi vào process.env', () => {
      writeNear(`${ONLY_NEAR}=near-value\n`);

      loadEnvFiles();

      expect(process.env[ONLY_NEAR]).toBe('near-value');
    });

    it('tham số paths tùy chỉnh thay thế danh sách mặc định và giữ thứ tự ưu tiên', () => {
      const first = join(sandbox, 'first.env');
      const second = join(sandbox, 'second.env');
      writeFileSync(first, `${SHARED}=first\n`);
      writeFileSync(second, `${SHARED}=second\n${ONLY_ROOT}=r\n`);
      writeNear(`${ONLY_NEAR}=must-not-load\n`);
      const target: EnvTarget = {};

      loadEnvFiles(target, [first, second]);

      expect(target).toEqual({ [SHARED]: 'first', [ONLY_ROOT]: 'r' });
    });
  });

  describe('khớp thứ tự ưu tiên của ConfigModule.forRoot({ envFilePath })', () => {
    it('cùng một kết quả: file gần thắng, file gốc bổ sung khóa còn thiếu', async () => {
      writeRoot(`${SHARED}=from-root\n${ONLY_ROOT}=root-value\n`);
      writeNear(`${SHARED}=from-near\n${ONLY_NEAR}=near-value\n`);

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            envFilePath: [...ENV_FILE_PATHS],
            ignoreEnvVars: true,
          }),
        ],
      }).compile();
      const config = moduleRef.get(ConfigService);

      expect(config.get(SHARED)).toBe('from-near');
      expect(config.get(ONLY_NEAR)).toBe('near-value');
      expect(config.get(ONLY_ROOT)).toBe('root-value');
      await moduleRef.close();
    });
  });
});
