import { parse } from 'dotenv';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Cấu hình AI do admin lưu qua màn Settings. Trong container hệ thống file là tạm thời nên giá trị phải nằm trong
 * một file RIÊNG (volume `backend_state`, vd `/app/state/ai.env`), nạp lại lúc khởi động. Tách khỏi `.env` để
 * giá trị đã lưu không che vĩnh viễn `.env` gốc và để không bao giờ sửa `.env` do con người quản lý.
 */

/** Tên biến môi trường chỉ định đường dẫn file cấu hình AI đã lưu. */
export const SETTINGS_CONFIG_FILE_ENV = 'SETTINGS_CONFIG_FILE';

/** Mặc định (dev): file riêng cạnh nơi chạy, đã nằm trong `.gitignore`; KHÔNG ghi vào `.env`. */
export const DEFAULT_SETTINGS_CONFIG_FILE = '.settings.env';

/** Allowlist: chỉ đúng 9 khóa này được ghi/nạp; khóa khác trong file bị bỏ (chặn chèn biến như `MONGODB_URI`). */
export const AI_CONFIG_KEYS = [
  'OPENROUTER_AI_PROVIDER',
  'OPENROUTER_AI_MODEL',
  'OPENROUTER_API_KEY',
  'MUST1C_API_KEY',
  'MUST1C_MODEL',
  'NINEROUTER_BASE_URL',
  'NINEROUTER_API_KEY',
  'NINEROUTER_MODEL',
  'ACTIVE_AI_PLATFORM',
] as const;

export type AiConfigKey = (typeof AI_CONFIG_KEYS)[number];
export type AiConfigValues = Partial<Record<AiConfigKey, string>>;

/** Nơi nhận biến khi nạp, mặc định `process.env`; tách ra để test không làm bẩn môi trường thật. */
export type SettingsEnvTarget = Record<string, string | undefined>;

/** Kênh cảnh báo; thông điệp chỉ chứa đường dẫn + mã lỗi, TUYỆT ĐỐI không chứa giá trị cấu hình (API key). */
export type SettingsWarn = (message: string) => void;

const FILE_MODE = 0o600;
// Thứ tự thử dấu nháy: dotenv chỉ nở `\n` trong nháy kép nên nháy kép là lựa chọn cuối.
const QUOTES = ["'", '`', '"'] as const;

const errorCode = (err: unknown): string =>
  (err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

/** Đường dẫn tuyệt đối file cấu hình: `SETTINGS_CONFIG_FILE` nếu có, ngược lại `<cwd>/.settings.env`. */
export const resolveSettingsConfigPath = (
  env: SettingsEnvTarget = process.env,
  cwd: string = process.cwd(),
): string =>
  resolve(
    cwd,
    env[SETTINGS_CONFIG_FILE_ENV]?.trim() || DEFAULT_SETTINGS_CONFIG_FILE,
  );

/** Lọc đúng các khóa allowlist có giá trị chuỗi. */
const pickAllowed = (source: Record<string, unknown>): AiConfigValues => {
  const picked: AiConfigValues = {};
  for (const key of AI_CONFIG_KEYS) {
    const value = source[key];
    if (typeof value === 'string') picked[key] = value;
  }
  return picked;
};

/**
 * Đọc file cấu hình. File thiếu => `{}` êm; không đọc được (quyền, là thư mục...) => `{}` kèm cảnh báo;
 * file hỏng thì dotenv bỏ qua dòng sai. Khóa ngoài allowlist bị loại.
 */
export const readSettingsConfigFile = (
  filePath: string,
  warn?: SettingsWarn,
): AiConfigValues => {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') {
      warn?.(
        `Không đọc được file cấu hình AI ${filePath} (${errorCode(err)}); bỏ qua`,
      );
    }
    return {};
  }
  return pickAllowed(parse(raw));
};

/**
 * Nạp file vào `target`: file lưu THẮNG giá trị đã có (từ `.env`/compose) cho đúng các khóa allowlist.
 * Trả tên các khóa đã áp dụng (không trả giá trị).
 */
export const applySettingsConfigFile = (
  target: SettingsEnvTarget,
  filePath: string,
  warn?: SettingsWarn,
): AiConfigKey[] => {
  const values = readSettingsConfigFile(filePath, warn);
  const applied: AiConfigKey[] = [];
  for (const key of AI_CONFIG_KEYS) {
    const value = values[key];
    if (value === undefined) continue;
    target[key] = value;
    applied.push(key);
  }
  return applied;
};

/** Bọc giá trị bằng dấu nháy mà dotenv đọc lại nguyên vẹn (an toàn với `#`, khoảng trắng, `=`). */
const quoteValue = (key: string, value: string): string => {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Giá trị của ${key} chứa ký tự xuống dòng`);
  }
  const quote = QUOTES.find((q) => !value.includes(q));
  if (!quote) {
    throw new Error(`Giá trị của ${key} chứa cả ba loại dấu nháy`);
  }
  return `${quote}${value}${quote}`;
};

/**
 * Gộp `updates` vào file cấu hình rồi ghi bền: tạo thư mục cha, ghi file tạm (quyền 0600 vì chứa API key) rồi
 * `rename` để không bao giờ để lại file ghi dở. Nội dung cũ của file được giữ cho khóa không đổi; khóa ngoài
 * allowlist không bao giờ được ghi. Lỗi I/O được ném lên (thông điệp không chứa giá trị).
 */
export const writeSettingsConfigFile = (
  filePath: string,
  updates: AiConfigValues,
): void => {
  const merged = {
    ...readSettingsConfigFile(filePath),
    ...pickAllowed(updates),
  };
  const lines = AI_CONFIG_KEYS.filter((key) => merged[key] !== undefined).map(
    (key) => `${key}=${quoteValue(key, merged[key] as string)}`,
  );
  const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';

  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    // Xóa tmp sót lại (nếu có) để `mode` chắc chắn áp dụng cho file mới.
    rmSync(tmpPath, { force: true });
    writeFileSync(tmpPath, content, { encoding: 'utf8', mode: FILE_MODE });
    renameSync(tmpPath, filePath);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
};
