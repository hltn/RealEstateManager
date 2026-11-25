import { config as loadDotenv } from 'dotenv';

/**
 * Các file `.env` backend nạp, tính từ thư mục chạy (cwd), THEO THỨ TỰ ƯU TIÊN GIẢM DẦN (FR-18):
 *  1. `.env` cạnh nơi chạy (ví dụ `RealEstateBackendApp/.env`) - thắng nếu khai báo cùng khóa;
 *  2. `../.env` ở gốc repo - file `.env` duy nhất dùng chung cho mọi môi trường.
 * File thiếu thì bỏ qua (trong container không có `.env`, biến do compose truyền vào). Biến đã có sẵn trong
 * `process.env` (shell, compose) LUÔN thắng cả hai file. Cùng thứ tự với `ConfigModule.forRoot({ envFilePath })`
 * và dotenv (khóa gặp ở file đứng trước được giữ).
 */
export const ENV_FILE_PATHS: readonly string[] = ['.env', '../.env'];

/** Nơi dotenv ghi biến vào, mặc định là `process.env`; tách ra để test không làm bẩn môi trường thật. */
export type EnvTarget = Record<string, string | undefined>;

/**
 * Nạp các file trong `paths` vào `target` bằng dotenv: không ghi đè khóa đã có, file đứng trước thắng file đứng sau,
 * file không tồn tại thì bỏ qua êm. `quiet`: dotenv >= 17 mặc định in một dòng ra stdout, làm bẩn đầu ra
 * `status --json` của CLI migration.
 */
export const loadEnvFiles = (
  target: EnvTarget = process.env,
  paths: readonly string[] = ENV_FILE_PATHS,
): void => {
  loadDotenv({
    path: [...paths],
    processEnv: target,
    quiet: true,
  });
};
