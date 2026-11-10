/**
 * UNIT — migration 010 (index mã khách + counter) và 011 (bỏ unique phone, một chiều) với Db giả.
 * Hành vi trên Mongo thật nằm ở `customer-identity-migrations.integration.spec.ts`.
 */
import type { Db } from 'mongodb';
import {
  COUNTER_KEY,
  CUSTOMER_CODE_INDEX,
} from '../modules/crm/customers/customer-code.constants';
import { createCustomerCodeIndex } from './customer-code-index';
import { dropUniquePhone } from './drop-unique-phone';
import { getMigrationPhase } from './migration-phase';
import { MIGRATIONS } from './migration.registry';
import { migration010CrmCustomerCodeIndex } from './versions/010_crm_customer_code_index';
import { migration011CrmDropUniquePhone } from './versions/011_crm_drop_unique_phone';

const mongoError = (code: number): Error =>
  Object.assign(new Error('mongo'), { code });

/** Index đúng spec `CUSTOMER_CODE_INDEX` như `indexes()` của driver trả về. */
const goodCodeIndex = () => ({
  v: 2,
  key: { customerCode: 1 },
  name: 'customerCode_1',
  unique: true,
  partialFilterExpression: { customerCode: { $type: 'string' } },
});

interface FakeOptions {
  indexes?: Record<string, unknown>[] | Error;
  createIndex?: jest.Mock;
  dropIndex?: jest.Mock;
  updateMany?: jest.Mock;
  updateOne?: jest.Mock;
}

/** Db giả: `customers` (indexes/createIndex/dropIndex/updateMany) và `counters` (updateOne), ghi lại thứ tự gọi. */
const fakeDb = (options: FakeOptions = {}) => {
  const calls: string[] = [];
  const track = (name: string, mock: jest.Mock): jest.Mock =>
    jest.fn((...args: unknown[]) => {
      calls.push(name);
      return mock(...args) as unknown;
    });
  const customers = {
    indexes: jest.fn(() =>
      options.indexes instanceof Error
        ? Promise.reject(options.indexes)
        : Promise.resolve(options.indexes ?? []),
    ),
    createIndex: track(
      'createIndex',
      options.createIndex ?? jest.fn().mockResolvedValue('ok'),
    ),
    dropIndex: track(
      'dropIndex',
      options.dropIndex ?? jest.fn().mockResolvedValue({ ok: 1 }),
    ),
    updateMany: track(
      'updateMany',
      options.updateMany ?? jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    ),
  };
  const counters = {
    updateOne:
      options.updateOne ?? jest.fn().mockResolvedValue({ upsertedCount: 1 }),
  };
  const db = {
    collection: (name: string) => (name === 'counters' ? counters : customers),
  } as unknown as Db;
  return { db, customers, counters, calls };
};

describe('migration 010 createCustomerCodeIndex', () => {
  it('FR-07: collection chưa có -> tạo index bằng CUSTOMER_CODE_INDEX và upsert counter seq 0', async () => {
    const { db, customers, counters } = fakeDb({ indexes: mongoError(26) });
    const log = jest.fn();

    const result = await createCustomerCodeIndex(db, log);

    expect(result).toEqual({ indexCreated: true, counterCreated: true });
    expect(customers.createIndex).toHaveBeenCalledWith(
      CUSTOMER_CODE_INDEX.key,
      CUSTOMER_CODE_INDEX.options,
    );
    expect(counters.updateOne).toHaveBeenCalledWith(
      { _id: COUNTER_KEY },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('FR-07: index đã đúng spec -> không tạo lại; counter đã có -> không ghi đè (chạy lại no-op)', async () => {
    const { db, customers } = fakeDb({
      indexes: [goodCodeIndex()],
      updateOne: jest.fn().mockResolvedValue({ upsertedCount: 0 }),
    });

    const result = await createCustomerCodeIndex(db);

    expect(result).toEqual({ indexCreated: false, counterCreated: false });
    expect(customers.createIndex).not.toHaveBeenCalled();
  });

  it.each([
    ['không unique', { ...goodCodeIndex(), unique: false }],
    [
      'không partial',
      { ...goodCodeIndex(), partialFilterExpression: undefined },
    ],
    [
      'partial khác',
      {
        ...goodCodeIndex(),
        partialFilterExpression: { customerCode: { $exists: true } },
      },
    ],
    ['sparse', { ...goodCodeIndex(), sparse: true }],
    ['có TTL', { ...goodCodeIndex(), expireAfterSeconds: 60 }],
    ['khác khóa', { ...goodCodeIndex(), key: { customerCode: -1 } }],
  ])(
    'FR-07: index cùng tên nhưng %s -> báo lỗi rõ, KHÔNG xóa, không upsert counter',
    async (_label, existing) => {
      const { db, customers, counters } = fakeDb({ indexes: [existing] });

      await expect(createCustomerCodeIndex(db)).rejects.toThrow(
        /customerCode_1.*xung đột.*KHÔNG tự xóa/s,
      );
      expect(customers.dropIndex).not.toHaveBeenCalled();
      expect(customers.createIndex).not.toHaveBeenCalled();
      expect(counters.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each([85, 86])(
    'FR-07: createIndex ném mã %d (index khác tên trùng khóa) -> đổi thành lỗi rõ ràng',
    async (code) => {
      const { db, counters } = fakeDb({
        createIndex: jest.fn().mockRejectedValue(mongoError(code)),
      });

      await expect(createCustomerCodeIndex(db)).rejects.toThrow(
        /xung đột.*KHÔNG tự xóa/s,
      );
      expect(counters.updateOne).not.toHaveBeenCalled();
    },
  );

  it('createIndex lỗi khác (ví dụ mạng) -> ném nguyên lỗi gốc', async () => {
    const original = mongoError(11000);
    const { db } = fakeDb({
      createIndex: jest.fn().mockRejectedValue(original),
    });

    await expect(createCustomerCodeIndex(db)).rejects.toBe(original);
  });

  it('indexes() lỗi khác "không có collection" -> ném lên, không nuốt', async () => {
    const original = mongoError(13);
    const { db } = fakeDb({ indexes: original });

    await expect(createCustomerCodeIndex(db)).rejects.toBe(original);
  });
});

describe('migration 011 dropUniquePhone', () => {
  it('FR-06: phone_1 đang unique -> dropIndex, tạo phone_1 thường, rồi mới chuyển anonymized về null (đúng thứ tự)', async () => {
    const { db, customers, calls } = fakeDb({
      indexes: [{ key: { phone: 1 }, name: 'phone_1', unique: true }],
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
    });

    const result = await dropUniquePhone(db, jest.fn());

    expect(result).toEqual({
      droppedUnique: true,
      createdPlain: true,
      clearedAnonymized: 3,
    });
    expect(calls).toEqual(['dropIndex', 'createIndex', 'updateMany']);
    expect(customers.dropIndex).toHaveBeenCalledWith('phone_1');
    expect(customers.createIndex).toHaveBeenCalledWith(
      { phone: 1 },
      { name: 'phone_1' },
    );
    expect(customers.updateMany).toHaveBeenCalledWith(
      { phone: { $regex: '^anonymized:' } },
      { $set: { phone: null } },
    );
  });

  it('FR-21: phone_1 đã thường -> không drop, không tạo lại (idempotent), vẫn dọn anonymized', async () => {
    const { db, customers } = fakeDb({
      indexes: [{ key: { phone: 1 }, name: 'phone_1' }],
    });

    const result = await dropUniquePhone(db);

    expect(result).toEqual({
      droppedUnique: false,
      createdPlain: false,
      clearedAnonymized: 0,
    });
    expect(customers.dropIndex).not.toHaveBeenCalled();
    expect(customers.createIndex).not.toHaveBeenCalled();
    expect(customers.updateMany).toHaveBeenCalledTimes(1);
  });

  it('FR-06: không có phone_1 (collection chưa có) -> chỉ tạo index thường', async () => {
    const { db, customers } = fakeDb({ indexes: mongoError(26) });

    const result = await dropUniquePhone(db);

    expect(result.droppedUnique).toBe(false);
    expect(result.createdPlain).toBe(true);
    expect(customers.dropIndex).not.toHaveBeenCalled();
  });

  it('FR-21: dropIndex gặp "index không tồn tại" (tiến trình khác vừa gỡ) -> bỏ qua, vẫn tạo index thường và dọn dữ liệu', async () => {
    const { db, customers } = fakeDb({
      indexes: [{ key: { phone: 1 }, name: 'phone_1', unique: true }],
      dropIndex: jest.fn().mockRejectedValue(mongoError(27)),
    });

    const result = await dropUniquePhone(db);

    expect(result.droppedUnique).toBe(false);
    expect(result.createdPlain).toBe(true);
    expect(customers.updateMany).toHaveBeenCalledTimes(1);
  });

  it('FR-06: dropIndex lỗi khác -> ném lên và KHÔNG chuyển anonymized (bước 3 phải đứng sau bước 1)', async () => {
    const original = mongoError(13);
    const { db, customers } = fakeDb({
      indexes: [{ key: { phone: 1 }, name: 'phone_1', unique: true }],
      dropIndex: jest.fn().mockRejectedValue(original),
    });

    await expect(dropUniquePhone(db)).rejects.toBe(original);
    expect(customers.createIndex).not.toHaveBeenCalled();
    expect(customers.updateMany).not.toHaveBeenCalled();
  });

  it('FR-06: index phone khác tên (không phải phone_1) không bị đụng', async () => {
    const { db, customers } = fakeDb({
      indexes: [{ key: { phone: 1, x: 1 }, name: 'phone_1_x_1', unique: true }],
    });

    await dropUniquePhone(db);

    expect(customers.dropIndex).not.toHaveBeenCalled();
  });
});

describe('đăng ký 010/011 vào runner', () => {
  it('FR-21: 010 mặc định pre-up, có up, không down; 011 là post-up, có up, không down', () => {
    expect(getMigrationPhase(migration010CrmCustomerCodeIndex)).toBe('pre-up');
    expect(migration010CrmCustomerCodeIndex.down).toBeUndefined();
    expect(getMigrationPhase(migration011CrmDropUniquePhone)).toBe('post-up');
    expect(migration011CrmDropUniquePhone.down).toBeUndefined();
  });

  it('FR-21: description 011 ghi rõ MỘT CHIỀU', () => {
    expect(migration011CrmDropUniquePhone.description).toContain('MỘT CHIỀU');
  });

  it('FR-21: registry chứa 010 và 011 ngay sau 009, theo thứ tự', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids.slice(-3)).toEqual([
      '009_notification_attachment_indexes',
      '010_crm_customer_code_index',
      '011_crm_drop_unique_phone',
    ]);
    expect(MIGRATIONS.at(-2)).toBe(migration010CrmCustomerCodeIndex);
    expect(MIGRATIONS.at(-1)).toBe(migration011CrmDropUniquePhone);
  });

  it('up của 010/011 gọi logic với db từ context', async () => {
    const a = fakeDb({ indexes: mongoError(26) });
    const log = jest.fn();
    await migration010CrmCustomerCodeIndex.up({
      client: {} as never,
      db: a.db,
      log,
    });
    expect(a.customers.createIndex).toHaveBeenCalledTimes(1);

    const b = fakeDb({ indexes: [] });
    await migration011CrmDropUniquePhone.up({
      client: {} as never,
      db: b.db,
      log,
    });
    expect(b.customers.updateMany).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
