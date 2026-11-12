/**
 * INTEGRATION — lệnh bù mã khách `crm-customer-codes` trên MongoDB Replica Set thật (mongodb-memory-server).
 * Chạy bằng `npm run test:integration`. Mỗi test ghi mã FR-xx mà nó kiểm (Plan 10_Dinh_Danh_Khach_Hang_Plan.md).
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { COUNTER_KEY } from '../modules/crm/customers/customer-code.constants';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCustomerCodesCli } from './crm-customer-codes-app';
import type { CustomerCodesCliDeps } from './crm-customer-codes-app';
import { createCustomerCodeIndex } from './customer-code-index';
import {
  CUSTOMER_CODES_GATE_ID,
  CUSTOMER_CODES_SCRIPT_DOC_ID,
} from './customer-codes-backfill';
import { EXIT_CODE } from './migration-runner';

jest.setTimeout(240_000);

interface CustomerRow {
  _id: ObjectId;
  createdAt: Date;
  customerCode?: string | null;
  deletedAt?: Date | null;
  phone?: string | null;
}

describe('runCustomerCodesCli (Mongo thật)', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let dbCounter = 0;

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    client = new MongoClient(replSet.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  /** DB mới; `gate` = đã ghi sổ migration 010 (mặc định có) và tạo index/counter như 010 thật. */
  const newDb = async (gate = true): Promise<{ db: Db; name: string }> => {
    dbCounter += 1;
    const name = `custcodes_${dbCounter}`;
    const db = client.db(name);
    if (gate) {
      await createCustomerCodeIndex(db);
      await db.collection<{ _id: string }>('system').insertOne({
        _id: CUSTOMER_CODES_GATE_ID,
        at: new Date(),
        by: 'test',
      } as never);
    }
    return { db, name };
  };

  const run = async (
    argv: string[],
    dbName: string,
    extra: Partial<CustomerCodesCliDeps> = {},
  ) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCustomerCodesCli(argv, {
      mongoUri: replSet.getUri(dbName),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...extra,
    });
    return { code, out, err };
  };

  /** `_id` tăng theo `second` để điều khiển thứ tự `_id` khi `createdAt` trùng nhau. */
  const oid = (second: number): ObjectId => ObjectId.createFromTime(second);
  const at = (day: number): Date => new Date(Date.UTC(2026, 0, day));

  const insertCustomers = (db: Db, rows: CustomerRow[]) =>
    db.collection<CustomerRow>('customers').insertMany(rows);

  const codeById = async (db: Db): Promise<Map<string, string | undefined>> => {
    const rows = await db
      .collection<CustomerRow>('customers')
      .find({}, { projection: { customerCode: 1 } })
      .toArray();
    return new Map(
      rows.map((row) => [row._id.toHexString(), row.customerCode ?? undefined]),
    );
  };

  const counterSeq = async (db: Db): Promise<number | undefined> =>
    (
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .findOne({ _id: COUNTER_KEY })
    )?.seq;

  /** N khách `createdAt` tăng dần theo ngày (đã đúng thứ tự cấp mã mong đợi). */
  const sequentialRows = (count: number, startSecond = 1): CustomerRow[] =>
    Array.from({ length: count }, (_, index) => ({
      _id: oid(startSecond + index),
      createdAt: at(1 + index),
    }));

  it('FR-21: sổ chưa có migration 010 -> thoát 0, in "chưa áp dụng", KHÔNG ghi gì (cả --apply)', async () => {
    const { db, name } = await newDb(false);
    await insertCustomers(db, sequentialRows(3));

    const { code, out } = await run(['--apply'], name);

    expect(code).toBe(EXIT_CODE.OK);
    expect(out.join('\n')).toContain('chưa áp dụng');
    expect(
      await db
        .collection('customers')
        .countDocuments({ customerCode: { $exists: true } }),
    ).toBe(0);
    expect(await counterSeq(db)).toBeUndefined();
    expect(
      await db
        .collection('system')
        .findOne({ _id: CUSTOMER_CODES_SCRIPT_DOC_ID } as never),
    ).toBeNull();
  });

  it('FR-08/FR-21: dry-run mặc định -> thoát 0, báo số thiếu (gồm xóa mềm) và KHÔNG ghi gì', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, [
      { _id: oid(1), createdAt: at(1) },
      { _id: oid(2), createdAt: at(2), deletedAt: at(3) },
    ]);
    const seqBefore = await counterSeq(db);

    const { code, out } = await run([], name);

    expect(code).toBe(EXIT_CODE.OK);
    expect(out.join('\n')).toContain('Dry-run');
    expect(out.join('\n')).toContain(
      'Khách thiếu mã: 2 (trong đó đã xóa mềm: 1)',
    );
    expect([...(await codeById(db)).values()]).toEqual([undefined, undefined]);
    expect(await counterSeq(db)).toBe(seqBefore);
    expect(
      await db
        .collection('system')
        .findOne({ _id: CUSTOMER_CODES_SCRIPT_DOC_ID } as never),
    ).toBeNull();
  });

  it('FR-08: cấp mã theo createdAt tăng dần, createdAt trùng thì theo _id (chèn vào không đúng thứ tự)', async () => {
    const { db, name } = await newDb();
    // Cố ý chèn xáo trộn. Thứ tự đúng: A(ngày 1) < B(ngày 2,_id nhỏ) < C(ngày 2,_id lớn) < D(ngày 5).
    const A = oid(10);
    const B = oid(20);
    const C = oid(30);
    const D = oid(1); // _id nhỏ nhất nhưng createdAt muộn nhất: phải đứng cuối
    await insertCustomers(db, [
      { _id: D, createdAt: at(5) },
      { _id: C, createdAt: at(2) },
      { _id: A, createdAt: at(1) },
      { _id: B, createdAt: at(2) },
    ]);

    const { code } = await run(['--apply'], name);

    const codes = await codeById(db);
    expect(code).toBe(EXIT_CODE.OK);
    expect(codes.get(A.toHexString())).toBe('KH-000001');
    expect(codes.get(B.toHexString())).toBe('KH-000002');
    expect(codes.get(C.toHexString())).toBe('KH-000003');
    expect(codes.get(D.toHexString())).toBe('KH-000004');
    expect(await counterSeq(db)).toBe(4);
  });

  it('FR-08: khách đã xóa mềm và khách ẩn danh (phone null, customerCode null) đều được cấp mã', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, [
      { _id: oid(1), createdAt: at(1), deletedAt: at(9) },
      { _id: oid(2), createdAt: at(2), phone: null, customerCode: null },
      { _id: oid(3), createdAt: at(3), deletedAt: null },
    ]);

    const { code } = await run(['--apply'], name);

    expect(code).toBe(EXIT_CODE.OK);
    expect([...(await codeById(db)).values()]).toEqual([
      'KH-000001',
      'KH-000002',
      'KH-000003',
    ]);
  });

  it('FR-08: chạy lại không đổi mã đã cấp, không tăng counter, assigned=0', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, sequentialRows(3));
    await run(['--apply'], name);
    const before = await codeById(db);

    const second = await run(['--apply'], name);

    expect(second.code).toBe(EXIT_CODE.OK);
    expect(second.out.join('\n')).toContain('assigned=0, remaining=0');
    expect(await codeById(db)).toEqual(before);
    expect(await counterSeq(db)).toBe(3);
  });

  it('FR-08: khách đã có mã giữ nguyên; khách thiếu mã nhận số kế sau counter đã cao, counter không lùi', async () => {
    const { db, name } = await newDb();
    await db
      .collection<{ _id: string; seq: number }>('counters')
      .updateOne({ _id: COUNTER_KEY }, { $set: { seq: 100 } });
    await insertCustomers(db, [
      { _id: oid(1), createdAt: at(1), customerCode: 'KH-000003' },
      { _id: oid(2), createdAt: at(2) },
      { _id: oid(3), createdAt: at(3) },
    ]);

    const { code } = await run(['--apply'], name);

    const codes = await codeById(db);
    expect(code).toBe(EXIT_CODE.OK);
    expect(codes.get(oid(1).toHexString())).toBe('KH-000003');
    expect(codes.get(oid(2).toHexString())).toBe('KH-000101');
    expect(codes.get(oid(3).toHexString())).toBe('KH-000102');
    expect(await counterSeq(db)).toBe(102);
  });

  it('FR-08: counter thấp hơn mã lớn nhất đang có (khôi phục dump) -> đồng bộ lên trước, mã mới không đụng E11000', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, [
      { _id: oid(1), createdAt: at(1), customerCode: 'KH-000007' },
      { _id: oid(2), createdAt: at(2) },
    ]);
    expect(await counterSeq(db)).toBe(0);

    const { code } = await run(['--apply'], name);

    expect(code).toBe(EXIT_CODE.OK);
    expect((await codeById(db)).get(oid(2).toHexString())).toBe('KH-000008');
    expect(await counterSeq(db)).toBe(8);
  });

  it('FR-08: không còn khách thiếu mã nhưng counter thấp hơn mã lớn nhất -> $max kéo counter lên (phòng thủ)', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, [
      { _id: oid(1), createdAt: at(1), customerCode: 'KH-000009' },
    ]);

    const { code } = await run(['--apply'], name);

    expect(code).toBe(EXIT_CODE.OK);
    expect(await counterSeq(db)).toBe(9);
  });

  it('FR-08/FR-21: tập lớn chia lô theo batchSize, mã liền mạch theo thứ tự thời gian, không trùng', async () => {
    const { db, name } = await newDb();
    // 25 khách chèn đảo ngược để chắc chắn thứ tự cấp không phụ thuộc thứ tự chèn.
    await insertCustomers(db, sequentialRows(25).reverse());

    const { code, out } = await run(['--apply'], name, { batchSize: 10 });

    const rows = await db
      .collection<CustomerRow>('customers')
      .find({})
      .sort({ createdAt: 1 })
      .toArray();
    expect(code).toBe(EXIT_CODE.OK);
    expect(out.join('\n')).toContain('Lô 3: đã cấp mã cho 5 khách (tổng 25)');
    expect(out.join('\n')).not.toContain('Lô 4');
    expect(rows.map((row) => row.customerCode)).toEqual(
      Array.from(
        { length: 25 },
        (_, index) => `KH-${String(index + 1).padStart(6, '0')}`,
      ),
    );
    expect(await counterSeq(db)).toBe(25);
  });

  it('FR-08/FR-21: lỗi giữa chừng (sau lô 2) -> thoát 1, lô đã commit giữ nguyên; chạy lại nối tiếp, gồm khách chèn chen', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, sequentialRows(25));

    const failed = await run(['--apply'], name, {
      batchSize: 10,
      afterBatch: ({ batch }) => {
        if (batch === 2) throw new Error('mất điện giả lập');
      },
    });

    expect(failed.code).toBe(EXIT_CODE.FAILURE);
    expect(failed.err.join('\n')).toContain('mất điện giả lập');
    expect(
      await db
        .collection('customers')
        .countDocuments({ customerCode: { $exists: true } }),
    ).toBe(20);
    expect(await counterSeq(db)).toBe(20);
    const afterFail = await codeById(db);

    // Khách chèn chen sau lần chạy dở (vd. image cũ ghi vào khoảng trống), createdAt cũ hơn phần còn lại.
    const stray = oid(500);
    await insertCustomers(db, [{ _id: stray, createdAt: at(21) }]);

    const resumed = await run(['--apply'], name, { batchSize: 10 });

    const codes = await codeById(db);
    expect(resumed.code).toBe(EXIT_CODE.OK);
    // Mã 20 khách đầu không đổi.
    for (const [id, code] of afterFail) {
      if (code) expect(codes.get(id)).toBe(code);
    }
    // 6 khách còn lại (21..25 + stray) nhận KH-000021..26 theo createdAt rồi _id.
    expect(codes.get(oid(21).toHexString())).toBe('KH-000021');
    expect(codes.get(stray.toHexString())).toBe('KH-000022');
    expect(codes.get(oid(25).toHexString())).toBe('KH-000026');
    expect(new Set(codes.values()).size).toBe(26);
    expect(await counterSeq(db)).toBe(26);
  });

  it('FR-21: lô lỗi khi ghi (validator từ chối một mã) -> rollback cả $inc, không thủng số; sửa xong chạy lại cấp đúng số cũ', async () => {
    const { db, name } = await newDb(false);
    await db.createCollection('customers', {
      validator: { customerCode: { $ne: 'KH-000003' } },
      validationAction: 'error',
    });
    await createCustomerCodeIndex(db);
    await db.collection('system').insertOne({
      _id: CUSTOMER_CODES_GATE_ID,
      at: new Date(),
      by: 'test',
    } as never);
    await insertCustomers(db, sequentialRows(4));

    const failed = await run(['--apply'], name, { batchSize: 2 });

    expect(failed.code).toBe(EXIT_CODE.FAILURE);
    expect(failed.err.join('\n')).toContain('LỖI');
    const codes = await codeById(db);
    expect(codes.get(oid(1).toHexString())).toBe('KH-000001');
    expect(codes.get(oid(2).toHexString())).toBe('KH-000002');
    expect(codes.get(oid(3).toHexString())).toBeUndefined();
    expect(codes.get(oid(4).toHexString())).toBeUndefined();
    // $inc của lô 2 đã rollback cùng bulkWrite: counter dừng ở 2 (không thủng số).
    expect(await counterSeq(db)).toBe(2);

    await db.command({ collMod: 'customers', validator: {} });
    const resumed = await run(['--apply'], name, { batchSize: 2 });

    expect(resumed.code).toBe(EXIT_CODE.OK);
    const finalCodes = await codeById(db);
    expect(finalCodes.get(oid(3).toHexString())).toBe('KH-000003');
    expect(finalCodes.get(oid(4).toHexString())).toBe('KH-000004');
    expect(await counterSeq(db)).toBe(4);
  });

  it('FR-08/FR-21: --apply ghi doc vết script:crm-customer-codes (assigned, remaining, by) và không đụng sổ migration', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, sequentialRows(3));

    await run(['--apply'], name);

    const doc = await db
      .collection('system')
      .findOne({ _id: CUSTOMER_CODES_SCRIPT_DOC_ID } as never);
    expect(doc).toMatchObject({
      assigned: 3,
      remaining: 0,
      by: 'crm-customer-codes-cli',
    });
    expect(doc?.lastRunAt).toBeInstanceOf(Date);
    expect(
      await db.collection('system').countDocuments({ _id: /^migration:/ }),
    ).toBe(1);
  });

  it('FR-21: đối soát phát hiện mã trùng (index unique bị gỡ) -> thoát 1 dù không còn khách thiếu mã', async () => {
    const { db, name } = await newDb();
    await db.collection('customers').dropIndex('customerCode_1');
    await insertCustomers(db, [
      { _id: oid(1), createdAt: at(1), customerCode: 'KH-000001' },
      { _id: oid(2), createdAt: at(2), customerCode: 'KH-000001' },
    ]);

    const { code, err } = await run(['--apply'], name);

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('\n')).toContain('1 mã trùng');
  });

  it('FR-21: batchSize không hợp lệ -> thoát 1 với thông báo rõ, không ghi gì', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, sequentialRows(1));

    const { code, err } = await run(['--apply'], name, { batchSize: 0 });

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('\n')).toContain('Kích thước lô');
    expect((await codeById(db)).get(oid(1).toHexString())).toBeUndefined();
  });

  it('FR-21: không in chuỗi kết nối/mật khẩu ở bất kỳ đường ra nào (cả lỗi ghi giữa chừng)', async () => {
    const { db, name } = await newDb();
    await insertCustomers(db, sequentialRows(2));
    const uri = replSet.getUri(name);

    const { out, err } = await run(['--apply'], name, {
      batchSize: 1,
      afterBatch: () => {
        throw new Error(`mất kết nối tới ${uri}`);
      },
    });

    const all = [...out, ...err].join('\n');
    expect(all).not.toContain(uri);
    expect(all).not.toContain('mongodb://');
  });

  it('FR-21: không kết nối được máy chủ -> thoát 1, in gợi ý kết nối và KHÔNG lộ mật khẩu trong URI', async () => {
    const out: string[] = [];
    const err: string[] = [];

    const code = await runCustomerCodesCli(['--apply'], {
      mongoUri: 'mongodb://admin:secretpw@127.0.0.1:1/crm',
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      serverSelectionTimeoutMs: 300,
    });

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect([...out, ...err].join('\n')).not.toContain('secretpw');
    expect(err.join('\n')).toContain('Gợi ý');
  });
});
