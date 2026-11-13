import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AI_CONFIG_KEYS,
  applySettingsConfigFile,
  DEFAULT_SETTINGS_CONFIG_FILE,
  readSettingsConfigFile,
  resolveSettingsConfigPath,
  SETTINGS_CONFIG_FILE_ENV,
  SettingsEnvTarget,
  writeSettingsConfigFile,
} from './settings-config-file';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs: typeof import('node:fs') = require('node:fs'); // đối tượng CJS gốc để jest.spyOn được

const SECRET = 'sk-SUPER-SECRET-VALUE-123';

describe('settings-config-file', () => {
  let sandbox: string;
  let stateDir: string;
  let filePath: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'settings-config-'));
    stateDir = join(sandbox, 'state');
    filePath = join(stateDir, 'ai.env');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('allowlist đúng 9 khóa AI', () => {
    expect([...AI_CONFIG_KEYS].sort()).toEqual(
      [
        'ACTIVE_AI_PLATFORM',
        'MUST1C_API_KEY',
        'MUST1C_MODEL',
        'NINEROUTER_API_KEY',
        'NINEROUTER_BASE_URL',
        'NINEROUTER_MODEL',
        'OPENROUTER_AI_MODEL',
        'OPENROUTER_AI_PROVIDER',
        'OPENROUTER_API_KEY',
      ].sort(),
    );
  });

  describe('resolveSettingsConfigPath', () => {
    it('tên biến môi trường là SETTINGS_CONFIG_FILE', () => {
      expect(SETTINGS_CONFIG_FILE_ENV).toBe('SETTINGS_CONFIG_FILE');
    });

    it('mặc định là .settings.env cạnh cwd, KHÔNG phải .env', () => {
      const resolved = resolveSettingsConfigPath({}, sandbox);

      expect(DEFAULT_SETTINGS_CONFIG_FILE).toBe('.settings.env');
      expect(resolved).toBe(join(sandbox, '.settings.env'));
      expect(resolved).not.toBe(join(sandbox, '.env'));
    });

    it('dùng SETTINGS_CONFIG_FILE khi có (đường dẫn tuyệt đối)', () => {
      expect(
        resolveSettingsConfigPath({ SETTINGS_CONFIG_FILE: filePath }, '/x'),
      ).toBe(filePath);
    });

    it('đường dẫn tương đối tính từ cwd; giá trị rỗng/khoảng trắng rơi về mặc định', () => {
      expect(
        resolveSettingsConfigPath(
          { SETTINGS_CONFIG_FILE: 'cfg/a.env' },
          sandbox,
        ),
      ).toBe(resolve(sandbox, 'cfg/a.env'));
      expect(
        resolveSettingsConfigPath({ SETTINGS_CONFIG_FILE: '   ' }, sandbox),
      ).toBe(join(sandbox, '.settings.env'));
    });
  });

  describe('writeSettingsConfigFile + readSettingsConfigFile', () => {
    it('ghi rồi đọc lại đủ 9 khóa; tạo cả thư mục cha còn thiếu', () => {
      const values = Object.fromEntries(
        AI_CONFIG_KEYS.map((key) => [key, `value-of-${key}`]),
      );

      writeSettingsConfigFile(filePath, values);

      expect(readSettingsConfigFile(filePath)).toEqual(values);
    });

    it('khóa ngoài allowlist trong `updates` không bao giờ được ghi', () => {
      writeSettingsConfigFile(filePath, {
        OPENROUTER_AI_MODEL: 'm',
        MONGODB_URI: 'mongodb://evil',
      } as never);

      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain('OPENROUTER_AI_MODEL=');
      expect(content).not.toContain('MONGODB_URI');
    });

    it('gộp với nội dung cũ: khóa không đổi được giữ, khóa trùng bị thay (không trùng dòng)', () => {
      writeSettingsConfigFile(filePath, {
        OPENROUTER_AI_MODEL: 'old',
        MUST1C_MODEL: 'keep',
      });

      writeSettingsConfigFile(filePath, {
        OPENROUTER_AI_MODEL: 'new',
        ACTIVE_AI_PLATFORM: '9Router',
      });

      expect(readSettingsConfigFile(filePath)).toEqual({
        OPENROUTER_AI_MODEL: 'new',
        MUST1C_MODEL: 'keep',
        ACTIVE_AI_PLATFORM: '9Router',
      });
      const lines = readFileSync(filePath, 'utf8').trim().split('\n');
      expect(
        lines.filter((l) => l.startsWith('OPENROUTER_AI_MODEL=')),
      ).toHaveLength(1);
    });

    it.each([
      ['có #, khoảng trắng và dấu bằng', 'a b#c=d'],
      ['có dấu nháy đơn', "it's-a-key"],
      ['có dấu nháy đơn và backtick', "it's`x"],
      ['có dấu gạch chéo ngược cuối', 'abc\\'],
      ['chứa \\n dạng chữ', 'a\\nb'],
      ['có $ và dấu ngoặc', 'k$(x)${Y}'],
      ['rỗng', ''],
    ])('giá trị %s đọc lại nguyên vẹn', (_label, value) => {
      writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: value });

      expect(readSettingsConfigFile(filePath).OPENROUTER_API_KEY).toBe(value);
    });

    it('giá trị chứa xuống dòng bị từ chối, file không bị ghi (chống chèn biến)', () => {
      expect(() =>
        writeSettingsConfigFile(filePath, {
          OPENROUTER_AI_MODEL: 'x\nMONGODB_URI=evil',
        }),
      ).toThrow(/OPENROUTER_AI_MODEL.*xuống dòng/);
      expect(existsSync(filePath)).toBe(false);
    });

    it('giá trị chứa cả ba loại nháy bị từ chối, thông điệp lỗi KHÔNG chứa giá trị', () => {
      const value = `${SECRET}'\`"`;

      let message = '';
      try {
        writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: value });
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain('OPENROUTER_API_KEY');
      expect(message).not.toContain(SECRET);
    });

    it('file ghi ra có quyền 0600 (chứa API key) và không để lại file tạm', () => {
      writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: SECRET });

      if (process.platform !== 'win32') {
        expect(statSync(filePath).mode & 0o777).toBe(0o600);
      }
      expect(readdirSync(stateDir)).toEqual(['ai.env']);
    });

    it('yêu cầu mode 0o600 khi ghi file tạm (kiểm độc lập nền tảng, Windows bỏ qua bit quyền)', () => {
      const spy = jest.spyOn(nodeFs, 'writeFileSync');
      try {
        writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: SECRET });

        expect(spy).toHaveBeenCalledWith(
          expect.stringMatching(/.tmp$/),
          expect.any(String),
          expect.objectContaining({ mode: 0o600 }),
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('ghi đè file có sẵn quyền rộng vẫn cho kết quả 0600', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(filePath, "OPENROUTER_AI_MODEL='x'\n");
      chmodSync(filePath, 0o644);

      writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: SECRET });

      if (process.platform !== 'win32') {
        expect(statSync(filePath).mode & 0o777).toBe(0o600);
      }
    });

    it('ghi lỗi (thư mục cha là file thường): ném lỗi, thông điệp không lộ giá trị', () => {
      writeFileSync(stateDir, 'i am a file');

      let message = '';
      try {
        writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: SECRET });
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).not.toBe('');
      expect(message).not.toContain(SECRET);
      expect(readdirSync(sandbox)).toEqual(['state']);
    });

    it('rename lỗi (đích là thư mục): ném lỗi và dọn file tạm', () => {
      mkdirSync(filePath, { recursive: true });

      expect(() =>
        writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: SECRET }),
      ).toThrow();

      expect(readdirSync(stateDir)).toEqual(['ai.env']);
    });

    it('file chưa tồn tại: đọc trả {} và không cảnh báo', () => {
      const warn = jest.fn();

      expect(readSettingsConfigFile(filePath, warn)).toEqual({});
      expect(warn).not.toHaveBeenCalled();
    });

    it('không đọc được (đường dẫn là thư mục): trả {} kèm cảnh báo chỉ có đường dẫn + mã lỗi', () => {
      mkdirSync(filePath, { recursive: true });
      const warn = jest.fn();

      expect(readSettingsConfigFile(filePath, warn)).toEqual({});

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(filePath);
    });

    it('file hỏng (rác, dòng sai cú pháp): không ném, chỉ lấy dòng hợp lệ trong allowlist', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        filePath,
        '\u0000\u0001garbage\n===\nOPENROUTER_AI_MODEL=ok\n{{{ not env\nMONGODB_URI=evil\nJWT_SECRET=evil\n',
      );

      expect(readSettingsConfigFile(filePath)).toEqual({
        OPENROUTER_AI_MODEL: 'ok',
      });
    });

    it('file rỗng: {}', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(filePath, '');

      expect(readSettingsConfigFile(filePath)).toEqual({});
    });

    it('ghi `updates` rỗng trên file chưa có tạo file rỗng, không ném', () => {
      writeSettingsConfigFile(filePath, {});

      expect(readFileSync(filePath, 'utf8')).toBe('');
    });
  });

  describe('applySettingsConfigFile', () => {
    it('file lưu THẮNG giá trị đã có trong target cho khóa allowlist; khóa khác giữ nguyên', () => {
      writeSettingsConfigFile(filePath, {
        OPENROUTER_AI_MODEL: 'from-file',
        OPENROUTER_API_KEY: 'key-from-file',
      });
      const target: SettingsEnvTarget = {
        OPENROUTER_AI_MODEL: 'from-env',
        OPENROUTER_API_KEY: 'key-from-compose',
        MUST1C_MODEL: 'untouched',
        MONGODB_URI: 'mongodb://real',
      };

      const applied = applySettingsConfigFile(target, filePath);

      expect(target).toEqual({
        OPENROUTER_AI_MODEL: 'from-file',
        OPENROUTER_API_KEY: 'key-from-file',
        MUST1C_MODEL: 'untouched',
        MONGODB_URI: 'mongodb://real',
      });
      expect(applied.sort()).toEqual([
        'OPENROUTER_AI_MODEL',
        'OPENROUTER_API_KEY',
      ]);
    });

    it('khóa ngoài allowlist trong file bị bỏ, không ghi đè target', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        filePath,
        'MONGODB_URI=evil\nJWT_SECRET=evil\nPATH=/evil\nACTIVE_AI_PLATFORM=9Router\n',
      );
      const target: SettingsEnvTarget = { MONGODB_URI: 'mongodb://real' };

      applySettingsConfigFile(target, filePath);

      expect(target).toEqual({
        MONGODB_URI: 'mongodb://real',
        ACTIVE_AI_PLATFORM: '9Router',
      });
    });

    it('file thiếu: target không đổi, không ném', () => {
      const target: SettingsEnvTarget = { OPENROUTER_AI_MODEL: 'from-env' };

      expect(applySettingsConfigFile(target, filePath)).toEqual([]);
      expect(target).toEqual({ OPENROUTER_AI_MODEL: 'from-env' });
    });

    it('không rò giá trị API key ra stdout/stderr/console/cảnh báo khi nạp', () => {
      writeSettingsConfigFile(filePath, { OPENROUTER_API_KEY: SECRET });
      const out = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
      const err = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warn = jest.fn();
      try {
        applySettingsConfigFile({}, filePath, warn);

        const everything = JSON.stringify([
          out.mock.calls,
          err.mock.calls,
          log.mock.calls,
          warn.mock.calls,
        ]);
        expect(everything).not.toContain(SECRET);
      } finally {
        out.mockRestore();
        err.mockRestore();
        log.mockRestore();
      }
    });
  });
});
