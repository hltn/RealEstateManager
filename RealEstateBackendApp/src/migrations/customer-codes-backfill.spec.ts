/**
 * UNIT — lõi bù mã khách `backfillCustomerCodes` (FR-08, FR-21) trên Mongo giả trong bộ nhớ (`FakeMongo`: lưu/lọc thật,
 * rollback transaction thật). Mọi khẳng định là GIÁ TRỊ cuối cùng của "DB" (mã gán cho từng khách, counter, doc vết),
 * không chỉ "hàm có được gọi". Hành vi trên Mongo thật (unique index, replica set) ở `crm-customer-codes-app.integration.spec.ts`.
 */
import { ObjectId } from 'mongodb';
import { COUNTER_KEY } from '../modules/crm/customers/customer-code.constants';
import {
  CUSTOMER_CODES_DEFAULT_BATCH_SIZE,
  CUSTOMER_CODES_GATE_ID,
  CUSTOMER_CODES_SCRIPT_ACTOR,
  CUSTOMER_CODES_SCRIPT_DOC_ID,
  CustomerCodesBatchMismatchError,
  backfillCustomerCodes,
} from './customer-codes-backfill';
import { FakeMongo } from './fake-mongo.fixture';
import type { FakeDoc } from './fake-mongo.fixture';
import { readMigrationState } from './migration-state';
import { SYSTEM_COLLECTION } from './system.constants';

const CUSTOMERS = 'customers';
const COUNTERS = 'counters';

/** `_id` tăng dần theo thứ tự tạo để biết trước thứ tự tie-break theo `_id`. */
const idOf = (n: number): ObjectId =>
  new ObjectId(n.toString(16).padStart(24, '0'));
const day = (n: number): Date => new Date(Date.UTC(2026, 0, n));

const customer = (n: number, extra: FakeDoc = {}): FakeDoc => ({
  _id: idOf(n),
  fullName: `Khách ${n}`,
  createdAt: day(n),
  ...extra,
});

const codeOf = (fake: FakeMongo, n: number): unknown =>
  fake.all(CUSTOMERS).find((doc) => (doc._id as ObjectId).equals(idOf(n)))
    ?.customerCode;

const counterSeq = (fake: FakeMongo): number | undefined =>
  fake.all(COUNTERS).find((doc) => doc._id === COUNTER_KEY)?.seq as
    | number
    | undefined;

const openGate = (fake: FakeMongo): FakeMongo =>
  fake.seed(SYSTEM_COLLECTION, [{ _id: CUSTOMER_CODES_GATE_ID, by: 'deploy' }]);

const run = (
  fake: FakeMongo,
  options: Partial<Parameters<typeof backfillCustomerCodes>[2]> = {},
) => {
  const lines: string[] = [];
  const promise = backfillCustomerCodes(fake.client, fake.db, {
    apply: true,
    log: (line) => lines.push(line),
    ...options,
  });
  return { lines, promise };
};

describe('backfillCustomerCodes', () => {
  describe('kiểm tra kích thước lô', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'batchSize=%p: ném RangeError và không đọc/ghi gì',
      async (batchSize) => {
        const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [customer(1)]);
        const before = fake.snapshot();

        const { promise } = run(fake, { batchSize });

        await expect(promise).rejects.toThrow(RangeError);
        await expect(promise).rejects.toThrow(
          `Kích thước lô phải là số nguyên >= 1, nhận: ${batchSize}`,
        );
        expect(fake.writeCalls).toBe(0);
        expect(fake.snapshot()).toEqual(before);
      },
    );
  });

  describe('cổng sổ migration 010', () => {
    it('chưa có doc migration 010: thoát sớm, gateOpen=false, không đụng khách/counter/doc vết dù --apply', async () => {
      const fake = new FakeMongo().seed(CUSTOMERS, [customer(1), customer(2)]);
      // Có migration khác trong sổ nhưng KHÔNG phải 010: không được mở cổng.
      fake.seed(SYSTEM_COLLECTION, [
        { _id: 'migration:009_notification_attachment_indexes' },
      ]);
      const before = fake.snapshot();

      const { lines, promise } = run(fake, { apply: true });
      const result = await promise;

      expect(result).toEqual({
        gateOpen: false,
        missingBefore: 0,
        missingSoftDeleted: 0,
        assigned: 0,
        remaining: 0,
        duplicateCodes: 0,
        batches: 0,
      });
      expect(lines).toEqual([
        `Sổ migration chưa có ${CUSTOMER_CODES_GATE_ID} (chưa áp dụng): bỏ qua, không bù mã.`,
      ]);
      expect(fake.writeCalls).toBe(0);
      expect(fake.snapshot()).toEqual(before);
      expect(codeOf(fake, 1)).toBeUndefined();
    });

    it('cổng đóng cũng áp dụng cho dry-run (không đếm khách)', async () => {
      const fake = new FakeMongo().seed(CUSTOMERS, [customer(1)]);

      const result = await run(fake, { apply: false }).promise;

      expect(result.gateOpen).toBe(false);
      expect(result.missingBefore).toBe(0);
    });
  });

  describe('--dry-run (apply=false)', () => {
    it('chỉ đếm: gồm khách thiếu trường, null, không phải chuỗi và đã xóa mềm; KHÔNG ghi gì (kể cả doc vết/counter)', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1), // thiếu trường
        customer(2, { customerCode: null }),
        customer(3, { customerCode: 12345 }), // không phải chuỗi => vẫn là thiếu mã
        customer(4, { deletedAt: day(20) }), // xóa mềm, thiếu mã
        customer(5, { customerCode: 'KH-000001' }), // đã có mã
        customer(6, { customerCode: null, deletedAt: null }), // deletedAt null KHÔNG phải xóa mềm
      ]);
      const before = fake.snapshot();

      const { lines, promise } = run(fake, { apply: false });
      const result = await promise;

      expect(result).toEqual({
        gateOpen: true,
        missingBefore: 5,
        missingSoftDeleted: 1,
        assigned: 0,
        remaining: 5,
        duplicateCodes: 0,
        batches: 0,
      });
      expect(lines).toEqual(['Khách thiếu mã: 5 (trong đó đã xóa mềm: 1).']);
      expect(fake.writeCalls).toBe(0);
      expect(fake.snapshot()).toEqual(before);
      expect(fake.all(COUNTERS)).toEqual([]);
      expect(fake.all(SYSTEM_COLLECTION).map((doc) => doc._id)).toEqual([
        CUSTOMER_CODES_GATE_ID,
      ]);
    });

    it('afterBatch không được gọi trong dry-run', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [customer(1)]);
      const afterBatch = jest.fn();

      await run(fake, { apply: false, afterBatch }).promise;

      expect(afterBatch).not.toHaveBeenCalled();
    });
  });

  describe('0 khách chờ bù mã (apply)', () => {
    it('không có khách nào: 0 lô, không gọi afterBatch, không tạo counter, vẫn ghi doc vết', async () => {
      const fake = openGate(new FakeMongo());
      const afterBatch = jest.fn();

      const { lines, promise } = run(fake, { afterBatch });
      const result = await promise;

      expect(result).toEqual({
        gateOpen: true,
        missingBefore: 0,
        missingSoftDeleted: 0,
        assigned: 0,
        remaining: 0,
        duplicateCodes: 0,
        batches: 0,
      });
      expect(afterBatch).not.toHaveBeenCalled();
      expect(lines).toEqual(['Khách thiếu mã: 0 (trong đó đã xóa mềm: 0).']);
      expect(fake.all(COUNTERS)).toEqual([]);
      const trace = fake
        .all(SYSTEM_COLLECTION)
        .find((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID);
      expect(trace).toMatchObject({
        assigned: 0,
        remaining: 0,
        by: CUSTOMER_CODES_SCRIPT_ACTOR,
      });
      expect(trace?.lastRunAt).toBeInstanceOf(Date);
    });

    it('mọi khách đã có mã: không đổi mã nào, counter được kéo LÊN bằng mã lớn nhất', async () => {
      const fake = openGate(new FakeMongo())
        .seed(CUSTOMERS, [
          customer(1, { customerCode: 'KH-000002' }),
          customer(2, { customerCode: 'KH-000007' }),
        ])
        .seed(COUNTERS, [{ _id: COUNTER_KEY, seq: 2 }]);

      const result = await run(fake).promise;

      expect(result.assigned).toBe(0);
      expect(result.batches).toBe(0);
      expect(codeOf(fake, 1)).toBe('KH-000002');
      expect(codeOf(fake, 2)).toBe('KH-000007');
      expect(counterSeq(fake)).toBe(7);
    });

    it('counter đã cao hơn mã lớn nhất thì KHÔNG bị kéo lùi ($max)', async () => {
      const fake = openGate(new FakeMongo())
        .seed(CUSTOMERS, [customer(1, { customerCode: 'KH-000003' })])
        .seed(COUNTERS, [{ _id: COUNTER_KEY, seq: 50 }]);

      await run(fake).promise;

      expect(counterSeq(fake)).toBe(50);
    });

    it('mã sai định dạng không được tính vào mã lớn nhất (chỉ mã chuẩn KH-xxxxxx)', async () => {
      const fake = openGate(new FakeMongo())
        .seed(CUSTOMERS, [
          customer(1, { customerCode: 'KH-000004' }),
          customer(2, { customerCode: 'KH-12' }),
          customer(3, { customerCode: 'kh-000099' }),
          customer(4, { customerCode: 'KH-0000070' }),
        ])
        .seed(COUNTERS, [{ _id: COUNTER_KEY, seq: 1 }]);

      await run(fake).promise;

      expect(counterSeq(fake)).toBe(4);
    });

    it('chạy lần hai (idempotent): không đổi mã đã cấp, doc vết vẫn chỉ một bản và assigned=0', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1),
        customer(2),
      ]);
      const first = await run(fake).promise;
      const codesAfterFirst = [codeOf(fake, 1), codeOf(fake, 2)];

      const second = await run(fake).promise;

      expect(first.assigned).toBe(2);
      expect(second).toMatchObject({
        assigned: 0,
        batches: 0,
        missingBefore: 0,
        remaining: 0,
      });
      expect([codeOf(fake, 1), codeOf(fake, 2)]).toEqual(codesAfterFirst);
      expect(counterSeq(fake)).toBe(2);
      const traces = fake
        .all(SYSTEM_COLLECTION)
        .filter((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID);
      expect(traces).toHaveLength(1);
      expect(traces[0].assigned).toBe(0);
    });
  });

  describe('thứ tự cấp mã theo createdAt rồi _id', () => {
    it('khách tạo sớm hơn được mã nhỏ hơn, cùng createdAt thì _id nhỏ hơn trước; mã bắt đầu sau mã lớn nhất hiện có', async () => {
      const sameMoment = day(10);
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        // Cố ý chèn lộn thứ tự để chứng minh thứ tự đến từ sort, không phải thứ tự chèn.
        customer(5, { createdAt: sameMoment }),
        customer(3, { createdAt: sameMoment }),
        customer(9, { createdAt: day(2) }),
        customer(1, { createdAt: day(30) }),
        customer(2, { customerCode: 'KH-000010', createdAt: day(1) }),
      ]);

      const result = await run(fake).promise;

      expect(result.assigned).toBe(4);
      // createdAt: 9 (ngày 2) < 3 = 5 (ngày 10, tie-break _id 3 < 5) < 1 (ngày 30); khách 2 giữ mã cũ.
      expect(codeOf(fake, 9)).toBe('KH-000011');
      expect(codeOf(fake, 3)).toBe('KH-000012');
      expect(codeOf(fake, 5)).toBe('KH-000013');
      expect(codeOf(fake, 1)).toBe('KH-000014');
      expect(codeOf(fake, 2)).toBe('KH-000010');
      expect(counterSeq(fake)).toBe(14);
    });

    it('khách thiếu createdAt (không có trường hoặc null) được xếp TRƯỚC khách có ngày, cùng nhau theo _id', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1, { createdAt: day(5) }),
        // Khách 7 không có trường createdAt, khách 3 có createdAt null: Mongo coi cả hai là "nhỏ nhất" khi sort tăng dần.
        { _id: idOf(7), fullName: 'Khách 7' },
        customer(3, { createdAt: null }),
        customer(2, { createdAt: day(1) }),
      ]);

      const result = await run(fake).promise;

      expect(result.assigned).toBe(4);
      expect(codeOf(fake, 3)).toBe('KH-000001');
      expect(codeOf(fake, 7)).toBe('KH-000002');
      expect(codeOf(fake, 2)).toBe('KH-000003');
      expect(codeOf(fake, 1)).toBe('KH-000004');
    });

    it('counter thấp hơn mã đã có (khôi phục dump) không làm đụng mã: lô đầu cấp tiếp SAU mã lớn nhất', async () => {
      const fake = openGate(new FakeMongo())
        .seed(CUSTOMERS, [
          customer(1, { customerCode: 'KH-000020' }),
          customer(2),
        ])
        .seed(COUNTERS, [{ _id: COUNTER_KEY, seq: 3 }]);

      await run(fake).promise;

      expect(codeOf(fake, 2)).toBe('KH-000021');
      expect(counterSeq(fake)).toBe(21);
    });
  });

  describe('khách xóa mềm', () => {
    it('vẫn được cấp mã (để index unique/đối soát đủ), thống kê tách riêng missingSoftDeleted', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1),
        customer(2, { deletedAt: day(25) }),
        customer(3, { deletedAt: null }),
      ]);

      const result = await run(fake).promise;

      expect(result).toMatchObject({
        missingBefore: 3,
        missingSoftDeleted: 1,
        assigned: 3,
        remaining: 0,
      });
      expect(codeOf(fake, 1)).toBe('KH-000001');
      expect(codeOf(fake, 2)).toBe('KH-000002');
      expect(codeOf(fake, 3)).toBe('KH-000003');
      // deletedAt không bị đụng tới.
      expect(
        fake.all(CUSTOMERS).find((doc) => (doc._id as ObjectId).equals(idOf(2)))
          ?.deletedAt,
      ).toEqual(day(25));
    });
  });

  describe('biên kích thước lô', () => {
    it.each<[number, number, number[]]>([
      // [số khách, batchSize, các lô mong đợi]
      [5, 1, [1, 1, 1, 1, 1]],
      [5, 2, [2, 2, 1]],
      [4, 2, [2, 2]],
      [5, 4, [4, 1]],
      [5, 5, [5]],
      [5, 6, [5]],
      [5, 500, [5]],
    ])(
      '%i khách, batchSize=%i => các lô %j; mã liên tục, không thủng số',
      async (total, batchSize, expectedBatches) => {
        const fake = openGate(new FakeMongo()).seed(
          CUSTOMERS,
          Array.from({ length: total }, (_, i) => customer(i + 1)),
        );
        const progress: Array<{ batch: number; assigned: number }> = [];

        const { lines, promise } = run(fake, {
          batchSize,
          afterBatch: (info) => {
            progress.push(info);
          },
        });
        const result = await promise;

        expect(result.batches).toBe(expectedBatches.length);
        expect(result.assigned).toBe(total);
        expect(result.remaining).toBe(0);
        let running = 0;
        expect(progress).toEqual(
          expectedBatches.map((size, index) => {
            running += size;
            return { batch: index + 1, assigned: running };
          }),
        );
        expect(lines).toHaveLength(1 + expectedBatches.length);
        for (let n = 1; n <= total; n += 1) {
          expect(codeOf(fake, n)).toBe(`KH-${String(n).padStart(6, '0')}`);
        }
        expect(counterSeq(fake)).toBe(total);
      },
    );

    it(`mặc định ${CUSTOMER_CODES_DEFAULT_BATCH_SIZE}/lô: ${CUSTOMER_CODES_DEFAULT_BATCH_SIZE + 1} khách => 2 lô (500 + 1)`, async () => {
      const total = CUSTOMER_CODES_DEFAULT_BATCH_SIZE + 1;
      const fake = openGate(new FakeMongo()).seed(
        CUSTOMERS,
        Array.from({ length: total }, (_, i) => customer(i + 1)),
      );
      const sizes: number[] = [];
      let previous = 0;

      const result = await run(fake, {
        afterBatch: ({ assigned }) => {
          sizes.push(assigned - previous);
          previous = assigned;
        },
      }).promise;

      expect(CUSTOMER_CODES_DEFAULT_BATCH_SIZE).toBe(500);
      expect(result.batches).toBe(2);
      expect(sizes).toEqual([500, 1]);
      expect(counterSeq(fake)).toBe(total);
    });

    it('afterBatch ném lỗi: dừng chạy nhưng các lô đã commit vẫn giữ; chạy lại nối tiếp phần còn thiếu', async () => {
      const fake = openGate(new FakeMongo()).seed(
        CUSTOMERS,
        Array.from({ length: 5 }, (_, i) => customer(i + 1)),
      );

      await expect(
        run(fake, {
          batchSize: 2,
          afterBatch: ({ batch }) => {
            if (batch === 2) throw new Error('mô phỏng sự cố sau lô 2');
          },
        }).promise,
      ).rejects.toThrow('mô phỏng sự cố sau lô 2');

      expect([1, 2, 3, 4].map((n) => codeOf(fake, n))).toEqual([
        'KH-000001',
        'KH-000002',
        'KH-000003',
        'KH-000004',
      ]);
      expect(codeOf(fake, 5)).toBeUndefined();
      // Lỗi giữa chừng: chưa đối soát cuối nên chưa có doc vết.
      expect(
        fake
          .all(SYSTEM_COLLECTION)
          .some((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID),
      ).toBe(false);

      const resumed = await run(fake, { batchSize: 2 }).promise;

      expect(resumed).toMatchObject({
        missingBefore: 1,
        assigned: 1,
        remaining: 0,
        batches: 1,
      });
      expect(codeOf(fake, 5)).toBe('KH-000005');
    });
  });

  describe('lô lệch (CustomerCodesBatchMismatchError)', () => {
    it('tiến trình khác cấp mã cho một khách giữa lúc đọc lô và lúc ghi: ném lỗi, rollback cả lô + counter, không ghi doc vết', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1),
        customer(2),
        customer(3),
      ]);
      fake.hooks.beforeTransaction = () => {
        // Khách thứ 2 của lô vừa được tiến trình khác cấp mã (sau khi đã đọc lô, trước khi ghi).
        const racing = fake
          .docsOf(CUSTOMERS)
          .find((doc) => (doc._id as ObjectId).equals(idOf(2)));
        if (racing) racing.customerCode = 'KH-000900';
      };
      const afterBatch = jest.fn();

      const { promise } = run(fake, { afterBatch });

      await expect(promise).rejects.toBeInstanceOf(
        CustomerCodesBatchMismatchError,
      );
      await expect(promise).rejects.toThrow('Lô bù mã cập nhật 2/3 khách');
      // Rollback: khách 1 và 3 (đã được updateOne trước khi phát hiện lô lệch) KHÔNG giữ mã; khách 2 giữ mã của tiến trình kia.
      expect(codeOf(fake, 1)).toBeUndefined();
      expect(codeOf(fake, 2)).toBe('KH-000900');
      expect(codeOf(fake, 3)).toBeUndefined();
      // $inc của lô cũng rollback: counter chỉ còn giá trị do bước đồng bộ ban đầu (chưa có mã hợp lệ nào => không có doc
      // hoặc chưa tăng theo lô).
      expect(counterSeq(fake)).toBeUndefined();
      expect(afterBatch).not.toHaveBeenCalled();
      expect(
        fake
          .all(SYSTEM_COLLECTION)
          .some((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID),
      ).toBe(false);
    });

    it('thông điệp lỗi nêu đúng số cập nhật/dự kiến và tên lỗi', () => {
      const error = new CustomerCodesBatchMismatchError(500, 499);

      expect(error.name).toBe('CustomerCodesBatchMismatchError');
      expect(error.message).toContain('499/500');
      expect(error.message).toContain('KHÔNG thủng số');
      expect(error).toBeInstanceOf(Error);
    });

    it('lô 2 lệch: lô 1 đã commit được giữ; chạy lại nối tiếp từ SAU mã lớn nhất, không thủng số', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1),
        customer(2),
        customer(3),
        customer(4),
      ]);
      fake.hooks.beforeTransaction = ({ call }) => {
        if (call !== 2) return;
        const racing = fake
          .docsOf(CUSTOMERS)
          .find((doc) => (doc._id as ObjectId).equals(idOf(4)));
        if (racing) racing.customerCode = 'KH-000042';
      };

      await expect(run(fake, { batchSize: 2 }).promise).rejects.toBeInstanceOf(
        CustomerCodesBatchMismatchError,
      );

      expect(codeOf(fake, 1)).toBe('KH-000001');
      expect(codeOf(fake, 2)).toBe('KH-000002');
      expect(codeOf(fake, 3)).toBeUndefined();
      expect(codeOf(fake, 4)).toBe('KH-000042');
      // Counter đã rollback về giá trị sau lô 1 (2), không phải 4.
      expect(counterSeq(fake)).toBe(2);

      fake.hooks.beforeTransaction = undefined;
      const resumed = await run(fake, { batchSize: 2 }).promise;

      expect(resumed).toMatchObject({ assigned: 1, remaining: 0 });
      // Đồng bộ counter với mã 42 rồi cấp tiếp: không tái sử dụng/đụng mã.
      expect(codeOf(fake, 3)).toBe('KH-000043');
      expect(counterSeq(fake)).toBe(43);
    });
  });

  describe('đối soát cuối', () => {
    it('phát hiện mã trùng giữa các khách (index unique đã bị gỡ) và báo duplicateCodes', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1, { customerCode: 'KH-000003' }),
        customer(2, { customerCode: 'KH-000003' }),
        customer(3, { customerCode: 'KH-000004' }),
        customer(4, { customerCode: 'KH-000005' }),
        customer(5, { customerCode: 'KH-000005' }),
        customer(6, { customerCode: 'KH-000005' }),
      ]);

      const result = await run(fake).promise;

      // Hai mã (000003 và 000005) bị trùng; mã 000004 duy nhất.
      expect(result.duplicateCodes).toBe(2);
      expect(result.remaining).toBe(0);
    });

    it('không có mã trùng: duplicateCodes=0', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1),
        customer(2),
      ]);

      const result = await run(fake).promise;

      expect(result.duplicateCodes).toBe(0);
    });

    it('doc vết ghi số liệu của lần chạy này', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [
        customer(1),
        customer(2),
      ]);
      const startedAt = Date.now();

      await run(fake).promise;

      const trace = fake
        .all(SYSTEM_COLLECTION)
        .find((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID);
      expect(trace).toMatchObject({
        assigned: 2,
        remaining: 0,
        by: CUSTOMER_CODES_SCRIPT_ACTOR,
      });
      expect((trace?.lastRunAt as Date).getTime()).toBeGreaterThanOrEqual(
        startedAt,
      );
    });

    it('doc vết KHÔNG lọt vào sổ migration: sau khi chạy, runner đọc sổ chỉ thấy migration 010 (cổng), không thấy script', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [customer(1)]);

      await run(fake).promise;
      const state = await readMigrationState(fake.db);

      // Doc vết có thật trong `system`...
      expect(
        fake
          .all(SYSTEM_COLLECTION)
          .some((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID),
      ).toBe(true);
      // ...nhưng sổ (theo đúng cách runner đọc) chỉ có cổng 010: không migration "ma", không đổi lock/version/lỗi.
      expect(state.applied.map((doc) => doc.id)).toEqual([
        '010_crm_customer_code_index',
      ]);
      expect(state.version).toBeNull();
      expect(state.lock).toBeNull();
      expect(state.lastError).toBeNull();
    });
  });

  describe('bộ đếm', () => {
    it.each<[string, unknown]>([
      ['chuỗi', 'abc'],
      ['null', null],
    ])(
      'counter có seq là %s (không phải số): $inc bị Mongo từ chối, ném lỗi, rollback, không khách nào có mã, không ghi doc vết',
      async (_label, badSeq) => {
        const fake = openGate(new FakeMongo())
          .seed(CUSTOMERS, [customer(1), customer(2)])
          .seed(COUNTERS, [{ _id: COUNTER_KEY, seq: badSeq }]);
        const afterBatch = jest.fn();

        await expect(run(fake, { afterBatch }).promise).rejects.toThrow(
          /\$inc/,
        );

        expect(codeOf(fake, 1)).toBeUndefined();
        expect(codeOf(fake, 2)).toBeUndefined();
        // Không tự "sửa" counter hỏng: giữ nguyên để người vận hành thấy và xử lý.
        expect(fake.all(COUNTERS)).toEqual([{ _id: COUNTER_KEY, seq: badSeq }]);
        expect(afterBatch).not.toHaveBeenCalled();
        expect(
          fake
            .all(SYSTEM_COLLECTION)
            .some((doc) => doc._id === CUSTOMER_CODES_SCRIPT_DOC_ID),
        ).toBe(false);
      },
    );

    it('doc counter tồn tại nhưng thiếu seq: coi như 0, mã bắt đầu từ KH-000001', async () => {
      const fake = openGate(new FakeMongo())
        .seed(CUSTOMERS, [customer(1), customer(2)])
        .seed(COUNTERS, [{ _id: COUNTER_KEY }]);

      await run(fake).promise;

      expect(codeOf(fake, 1)).toBe('KH-000001');
      expect(codeOf(fake, 2)).toBe('KH-000002');
      expect(counterSeq(fake)).toBe(2);
    });

    it('findOneAndUpdate không trả doc counter: ném lỗi rõ ràng, không gán mã', async () => {
      const fake = openGate(new FakeMongo()).seed(CUSTOMERS, [customer(1)]);
      jest
        .spyOn(fake.collection(COUNTERS), 'findOneAndUpdate')
        .mockResolvedValueOnce(null);

      await expect(run(fake).promise).rejects.toThrow(
        `Không cấp được bộ đếm ${COUNTER_KEY}`,
      );
      expect(codeOf(fake, 1)).toBeUndefined();
    });
  });
});
