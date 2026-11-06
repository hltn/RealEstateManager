import { MongoClient } from 'mongodb';
import {
  CatalogCodeOrphansError,
  CatalogCodesIncompleteError,
  migrateCatalogCodes,
} from '../modules/crm/catalogs/migrations/migrate-catalog-codes';
import {
  migrateProjectPropertyTypeCodes,
  PropertyTypeFieldMissingError,
} from '../modules/crm/catalogs/migrations/migrate-project-property-type-codes';
import { CONNECTION_HINT, isConnectionError } from './cli-app';
import { sanitizeErrorMessage } from './migration-error.util';
import { EXIT_CODE } from './migration-runner';
import type { ExitCode } from './migration-runner';

export const CATALOG_CODES_USAGE = `Cách dùng: node dist/migrations/crm-catalog-codes.cli.js [--apply]

  (không tham số)  Dry-run: chỉ đếm bản ghi còn thiếu mã, KHÔNG ghi gì.
  --apply          Điền mã còn thiếu (lệnh bù sau khi chạy lại bản cũ ghi chen giữa; chạy lại bao nhiêu lần cũng an toàn).

Hai bước chạy lần lượt: [1/2] mã danh mục (migration 007), [2/2] mã loại hình dự án (migration 008).
Một bước lỗi KHÔNG chặn bước còn lại; cuối cùng in tóm tắt từng bước.

Biến môi trường: MONGODB_URI (bắt buộc).
Mã thoát: 0 cả hai bước ok | 1 có bước lỗi, còn bản ghi mồ côi hoặc thiếu cấu hình property_type | 2 sai cú pháp.`;

export interface CatalogCodesCliDeps {
  mongoUri: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Hạn chọn máy chủ Mongo (ms); mặc định 10 giây. Chỉ test cần rút ngắn. */
  serverSelectionTimeoutMs?: number;
}

type StepOutcome = 'ok' | 'failed';

/** In lỗi của một bước (KHÔNG nuốt lỗi); trả `true` nếu là lỗi kết nối để nơi gọi in gợi ý kết nối. */
const reportStepError = (
  deps: CatalogCodesCliDeps,
  label: string,
  error: unknown,
): boolean => {
  if (error instanceof CatalogCodeOrphansError) {
    deps.err(`LỖI ${label}: ${error.message}`);
    for (const orphan of error.orphans) deps.err(`  mồ côi ${orphan}`);
    return false;
  }
  if (
    error instanceof CatalogCodesIncompleteError ||
    error instanceof PropertyTypeFieldMissingError
  ) {
    deps.err(`LỖI ${label}: ${error.message}`);
    return false;
  }
  deps.err(`LỖI ${label}: ${sanitizeErrorMessage(error)}`);
  return isConnectionError(error);
};

/**
 * Lệnh bù `crm-catalog-codes`: chạy lại ngoài sổ migration (H1: `deploy.sh` gọi sau `up`) HAI bước, theo thứ tự:
 *  [1/2] `migrateCatalogCodes` (007), [2/2] `migrateProjectPropertyTypeCodes` (008, bù dự án do image v1.0.3 tạo
 *  sau khi runner đã ghi sổ 008 nên thiếu `propertyTypeCodes`).
 *
 * Xử lý lỗi: hai bước độc lập dữ liệu (007 chạm khách/danh mục, 008 chạm `projects`) nên bước 2 LUÔN chạy dù bước 1
 * lỗi (kể cả `CatalogCodeOrphansError`), và ngược lại; mỗi bước tự có tính idempotent nên không mất dữ liệu. Lỗi của
 * từng bước được in ra stderr kèm nhãn bước, cuối cùng in tóm tắt; mã thoát 1 nếu BẤT KỲ bước nào lỗi.
 * Dry-run là mặc định. Trả mã thoát, KHÔNG gọi `process.exit`.
 */
export const runCatalogCodesCli = async (
  argv: readonly string[],
  deps: CatalogCodesCliDeps,
): Promise<ExitCode> => {
  const unknown = argv.filter((token) => token !== '--apply');
  if (unknown.length > 0) {
    deps.err(
      `Tham số không hợp lệ: ${unknown.join(' ')}
${CATALOG_CODES_USAGE}`,
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
        ? 'Chế độ --apply: điền mã còn thiếu.'
        : 'Dry-run (thêm --apply để ghi): chỉ đếm, không ghi.',
    );
    const db = client.db();
    const steps: { label: string; run: () => Promise<unknown> }[] = [
      {
        label: '[1/2] mã danh mục (007)',
        run: () => migrateCatalogCodes(db, apply, deps.out),
      },
      {
        label: '[2/2] mã loại hình dự án (008)',
        run: () => migrateProjectPropertyTypeCodes(db, apply, deps.out),
      },
    ];
    const outcomes: { label: string; outcome: StepOutcome }[] = [];
    let hasConnectionError = false;
    for (const step of steps) {
      deps.out(`Bắt đầu ${step.label}`);
      try {
        await step.run();
        outcomes.push({ label: step.label, outcome: 'ok' });
      } catch (error) {
        hasConnectionError =
          reportStepError(deps, step.label, error) || hasConnectionError;
        outcomes.push({ label: step.label, outcome: 'failed' });
      }
    }
    deps.out('Tóm tắt:');
    for (const { label, outcome } of outcomes) {
      deps.out(`  ${label}: ${outcome === 'ok' ? 'OK' : 'LỖI'}`);
    }
    if (hasConnectionError) deps.err(CONNECTION_HINT);
    return outcomes.every(({ outcome }) => outcome === 'ok')
      ? EXIT_CODE.OK
      : EXIT_CODE.FAILURE;
  } finally {
    await client.close().catch(() => undefined);
  }
};
