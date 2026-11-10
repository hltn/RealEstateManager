import {
  CUSTOMER_CODES_USAGE,
  runCustomerCodesCli,
} from './crm-customer-codes-app';
import { backfillCustomerCodes } from './customer-codes-backfill';
import type { CustomerCodesBackfillResult } from './customer-codes-backfill';
import { EXIT_CODE } from './migration-runner';

// Chỉ giả lập kết nối Mongo và lõi bù mã để kiểm điều phối (mã thoát theo kết quả). Hành vi ghi dữ liệu thật được kiểm
// ở file integration.
jest.mock('mongodb', () => {
  const actual = jest.requireActual<typeof import('mongodb')>('mongodb');
  return {
    ...actual,
    MongoClient: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      db: jest.fn().mockReturnValue({}),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});
jest.mock('./customer-codes-backfill', () => ({
  ...jest.requireActual<object>('./customer-codes-backfill'),
  backfillCustomerCodes: jest.fn(),
}));

const mockBackfill = backfillCustomerCodes as jest.MockedFunction<
  typeof backfillCustomerCodes
>;

const result = (
  patch: Partial<CustomerCodesBackfillResult> = {},
): CustomerCodesBackfillResult => ({
  gateOpen: true,
  missingBefore: 0,
  missingSoftDeleted: 0,
  assigned: 0,
  remaining: 0,
  duplicateCodes: 0,
  batches: 0,
  ...patch,
});

const run = async (argv: string[], mongoUri: string | undefined) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCustomerCodesCli(argv, {
    mongoUri,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
};

describe('runCustomerCodesCli', () => {
  beforeEach(() => {
    mockBackfill.mockReset().mockResolvedValue(result());
  });

  it('FR-21: tham số lạ -> mã USAGE kèm hướng dẫn, không kết nối, không bù', async () => {
    const { code, err, out } = await run(['--force'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.USAGE);
    expect(err.join('\n')).toContain('--force');
    expect(err.join('\n')).toContain(CUSTOMER_CODES_USAGE);
    expect(out).toEqual([]);
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  it('FR-21: thiếu MONGODB_URI -> mã FAILURE', async () => {
    const { code, err } = await run([], undefined);

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err).toEqual(['Thiếu biến môi trường MONGODB_URI.']);
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  it('FR-21: không có --apply -> truyền apply=false (dry-run mặc định); có --apply -> apply=true', async () => {
    await run([], 'mongodb://h/db');
    await run(['--apply'], 'mongodb://h/db');

    expect(
      mockBackfill.mock.calls.map(([, , options]) => options.apply),
    ).toEqual([false, true]);
  });

  it('FR-21: cổng sổ đóng -> thoát 0 và không in tóm tắt/thất bại', async () => {
    mockBackfill.mockResolvedValue(result({ gateOpen: false }));

    const { code, out, err } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.OK);
    expect(err).toEqual([]);
    expect(out.join('\n')).not.toContain('Tóm tắt');
  });

  it('FR-08: --apply còn khách thiếu mã sau đối soát -> thoát 1', async () => {
    mockBackfill.mockResolvedValue(result({ assigned: 3, remaining: 2 }));

    const { code, err } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('\n')).toContain('2 khách thiếu mã');
  });

  it('FR-08: --apply có mã trùng -> thoát 1', async () => {
    mockBackfill.mockResolvedValue(result({ duplicateCodes: 1 }));

    expect((await run(['--apply'], 'mongodb://h/db')).code).toBe(
      EXIT_CODE.FAILURE,
    );
  });

  it('FR-08: dry-run còn khách thiếu mã vẫn thoát 0 (chỉ đếm), in tóm tắt', async () => {
    mockBackfill.mockResolvedValue(result({ missingBefore: 5, remaining: 5 }));

    const { code, out } = await run([], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.OK);
    expect(out.join('\n')).toContain('remaining=5');
  });

  it('FR-21: lõi ném lỗi chứa chuỗi kết nối -> thoát 1, lỗi đã lọc, không lộ mật khẩu, nhắc chạy lại', async () => {
    mockBackfill.mockRejectedValue(
      new Error('hỏng tại mongodb://admin:secretpw@db:27017/crm'),
    );

    const { code, err } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('\n')).not.toContain('secretpw');
    expect(err.join('\n')).toContain('Chạy lại');
  });
});
