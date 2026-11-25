// Nạp cấu hình vào process.env NGAY khi module này được eval. `main.ts` import file này ĐẦU TIÊN để biến đã sẵn trước
// khi các module khác (CustomLogger lazy-init, schema đọc LOG_*, EmbeddingService đọc khóa AI trong constructor...) eval.
// Bước 1: các file `.env` (thứ tự: xem `ENV_FILE_PATHS`); biến đã có trong process.env (compose env_file/environment)
//   KHÔNG bị ghi đè.
// Bước 2: file cấu hình AI admin đã lưu (`SETTINGS_CONFIG_FILE`, mặc định `.settings.env`): THẮNG giá trị ở bước 1
//   cho đúng 9 khóa allowlist, để cấu hình lưu từ màn Settings sống qua restart/tạo lại container.
import { loadEnvFiles } from './env-files.config';
import {
  applySettingsConfigFile,
  resolveSettingsConfigPath,
} from './settings-config-file';

loadEnvFiles();
// Chưa có logger ở giai đoạn này nên cảnh báo đi thẳng stderr (thông điệp không chứa giá trị cấu hình).
applySettingsConfigFile(process.env, resolveSettingsConfigPath(), (message) =>
  process.stderr.write(`[settings-config] ${message}\n`),
);
