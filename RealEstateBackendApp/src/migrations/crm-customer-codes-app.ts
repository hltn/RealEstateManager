import { MongoClient } from 'mongodb';
import { CONNECTION_HINT, isConnectionError } from './cli-app';
import { backfillCustomerCodes } from './customer-codes-backfill';
import type { CustomerCodesBackfillOptions } from './customer-codes-backfill';
import { sanitizeErrorMessage } from './migration-error.util';
import { EXIT_CODE } from './migration-runner';
import type { ExitCode } from './migration-runner';

export const CUSTOMER_CODES_USAGE = `Cách dùng: node dist/migrations/crm-customer-codes.cli.js [--apply]

  (không tham số)  Dry-run: chỉ đếm khách còn thiếu mã, KHÔNG ghi gì.
  --apply          Bù mã khách còn thiếu theo lô (createdAt, _id), mỗi lô một transaction. Chạy lại bao nhiêu lần cũng an toàn:
                   khách đã có mã không bị đổi; chạy dở thì lần sau nối tiếp.

Chỉ làm việc khi sổ migration đã có 010_crm_customer_code_index; chưa có thì thoát 0 và không đụng dữ liệu.

Biến môi trường: MONGODB_URI (bắt buộc).
Mã thoát: 0 xong hoặc không có việc | 1 lỗi, còn khách thiếu mã hoặc mã trùng | 2 sai cú pháp.`;

export interface CustomerCodesCliDeps {
  mongoUri: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Hạn chọn máy chủ Mongo (ms); mặc định 10 giây. Chỉ test cần rút ngắn. */
  serverSelectionTimeoutMs?: number;
  /** Số khách mỗi lô; mặc định 500. Chỉ test cần thu nhỏ. */
  batchSize?: number;
  /** Móc sau mỗi lô đã commit (test mô phỏng sự cố giữa chừng). */
  afterBatch?: CustomerCodesBackfillOptions['afterBatch'];
}

/**
 * Lệnh bù mã khách `crm-customer-codes` (FR-08, FR-21): `deploy.sh` gọi `--apply` sau `up` qua điểm gọi hậu-migrate.
 * Dry-run là mặc định. Trả mã thoát, KHÔNG gọi `process.exit`; mọi thông điệp lỗi đi qua `sanitizeErrorMessage`
 * (không lộ chuỗi kết nối).
 */
export const runCustomerCodesCli = async (
  argv: readonly string[],
  deps: CustomerCodesCliDeps,
): Promise<ExitCode> => {
  const unknown = argv.filter((token) => token !== '--apply');
  if (unknown.length > 0) {
    deps.err(
      `Tham số không hợp lệ: ${unknown.join(' ')}
${CUSTOMER_CODES_USAGE}`,
    );
    return EXIT_CODE.USAGE;
  }
  const apply = argv.includes('--apply');
  if (!deps.mongoUri) {
    deps.err('Thiếu biến môi trường MONGODB_URI.');
    return EXIT_CODE.FAILURE;
  }

  const client = new MongoClient(deps.mongoUri, {
    serverSelectionTimeoutMS: deps.serverSelectionTimeoutMs ?? 10_000,
  });
  try {
    try {
      await client.connect();
    } catch (error) {
      deps.err(`LỖI: ${sanitizeErrorMessage(error)}`);
      deps.err(CONNECTION_HINT);
      return EXIT_CODE.FAILURE;
    }
    deps.out(
      apply
        ? 'Chế độ --apply: bù mã khách còn thiếu.'
        : 'Dry-run (thêm --apply để ghi): chỉ đếm, không ghi.',
    );

    let result;
    try {
      result = await backfillCustomerCodes(client, client.db(), {
        apply,
        batchSize: deps.batchSize,
        afterBatch: deps.afterBatch,
        log: deps.out,
      });
    } catch (error) {
      deps.err(`LỖI: ${sanitizeErrorMessage(error)}`);
      if (isConnectionError(error)) deps.err(CONNECTION_HINT);
      deps.err('Chạy lại lệnh --apply để nối tiếp phần còn thiếu.');
      return EXIT_CODE.FAILURE;
    }

    if (!result.gateOpen) return EXIT_CODE.OK;
    deps.out(
      `Tóm tắt: assigned=${result.assigned}, remaining=${result.remaining}, duplicates=${result.duplicateCodes}.`,
    );
    if (!apply) return EXIT_CODE.OK;
    if (result.remaining > 0 || result.duplicateCodes > 0) {
      deps.err(
        `LỖI: sau bù vẫn còn ${result.remaining} khách thiếu mã, ${result.duplicateCodes} mã trùng.`,
      );
      return EXIT_CODE.FAILURE;
    }
    return EXIT_CODE.OK;
  } finally {
    await client.close().catch(() => undefined);
  }
};
