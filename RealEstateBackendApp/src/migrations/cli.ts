/**
 * CLI migration: `node dist/migrations/cli.js <status|up|unlock|baseline>`.
 * KHÔNG khởi động NestJS; chỉ dùng MongoClient + MONGODB_URI (đã có sẵn trong env của container backend).
 * Mọi logic nằm ở `cli-app.ts`; file này chỉ nối vào process (env, stdout/stderr, mã thoát).
 */
import { config as loadDotenv } from 'dotenv';
import { readAppVersion } from './app-version.util';
import { runCli } from './cli-app';
import { sanitizeErrorMessage } from './migration-error.util';
import { EXIT_CODE } from './migration-runner';
import { MIGRATIONS } from './migration.registry';

/**
 * Nạp `.env` của thư mục hiện tại như backend (cùng thứ tự ưu tiên: biến môi trường đã có KHÔNG bị ghi đè, nên trong
 * container `MONGODB_URI` do compose dựng luôn thắng file `.env` bind-mount). `quiet`: dotenv >= 17 mặc định in một dòng
 * ra stdout, sẽ làm bẩn đầu ra `status --json`.
 */
loadDotenv({ quiet: true });

const writeLine = (stream: NodeJS.WriteStream, line: string): void => {
  stream.write(`${line}\n`);
};

const main = async (): Promise<number> => {
  try {
    const app = readAppVersion();
    return await runCli(process.argv.slice(2), {
      mongoUri: process.env.MONGODB_URI,
      migrations: MIGRATIONS,
      app: { version: app.version, commit: app.commit },
      out: (line) => writeLine(process.stdout, line),
      err: (line) => writeLine(process.stderr, line),
    });
  } catch (error) {
    writeLine(process.stderr, `LỖI: ${sanitizeErrorMessage(error)}`);
    return EXIT_CODE.FAILURE;
  }
};

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
