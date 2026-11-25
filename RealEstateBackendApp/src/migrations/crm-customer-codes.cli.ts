/**
 * Lệnh bù mã khách (FR-08, FR-21): `node dist/migrations/crm-customer-codes.cli.js [--apply]` (mặc định dry-run).
 * KHÔNG khởi động NestJS; chỉ dùng MongoClient + MONGODB_URI. Logic ở `crm-customer-codes-app.ts`.
 */
import { loadEnvFiles } from '../common/config/env-files.config';
import { runCustomerCodesCli } from './crm-customer-codes-app';
import { sanitizeErrorMessage } from './migration-error.util';
import { EXIT_CODE } from './migration-runner';

// Helper chung `['.env', '../.env']` (file gần thắng, quiet); biến môi trường đã có KHÔNG bị ghi đè.
loadEnvFiles();

const writeLine = (stream: NodeJS.WriteStream, line: string): void => {
  stream.write(`${line}\n`);
};

const main = async (): Promise<number> => {
  try {
    return await runCustomerCodesCli(process.argv.slice(2), {
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
