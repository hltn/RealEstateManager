/**
 * Lệnh bù mã danh mục + mã loại hình dự án (migration 007 rồi 008): `node dist/migrations/crm-catalog-codes.cli.js [--apply]` (mặc định dry-run).
 * KHÔNG khởi động NestJS; chỉ dùng MongoClient + MONGODB_URI. Logic ở `crm-catalog-codes-app.ts`.
 */
import { config as loadDotenv } from 'dotenv';
import { runCatalogCodesCli } from './crm-catalog-codes-app';
import { sanitizeErrorMessage } from './migration-error.util';
import { EXIT_CODE } from './migration-runner';

// `quiet`: dotenv >= 17 mặc định in một dòng ra stdout; biến môi trường đã có KHÔNG bị ghi đè.
loadDotenv({ quiet: true });

const writeLine = (stream: NodeJS.WriteStream, line: string): void => {
  stream.write(`${line}\n`);
};

const main = async (): Promise<number> => {
  try {
    return await runCatalogCodesCli(process.argv.slice(2), {
      mongoUri: process.env.MONGODB_URI,
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
