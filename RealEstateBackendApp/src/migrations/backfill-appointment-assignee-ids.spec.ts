/**
 * UNIT — migration 012 (FR-30): backfill `appointments.assigneeIds` trên Mongo giả trong bộ nhớ (`FakeMongo`: lưu/lọc
 * thật) và tạo index đa khóa. Khẳng định là GIÁ TRỊ cuối cùng của "DB". Hành vi trên Mongo thật do T-61.
 */
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import {
  backfillAppointmentAssigneeIds,
  backfillAssigneeIds,
  ensureAssigneeIdsIndex,
} from './backfill-appointment-assignee-ids';
import { FakeMongo } from './fake-mongo.fixture';
import type { FakeDoc } from './fake-mongo.fixture';
import { MONGO_NAMESPACE_NOT_FOUND } from './mongo-index.util';

const APPOINTMENTS = 'appointments';
const idOf = (n: number): ObjectId =>
  new ObjectId(n.toString(16).padStart(24, '0'));
const userA = idOf(901);
const userB = idOf(902);

const appointment = (n: number, extra: FakeDoc = {}): FakeDoc => ({
  _id: idOf(n),
  title: `Lịch ${n}`,
  ...extra,
});

const byId = (fake: FakeMongo, n: number): FakeDoc =>
  fake.all(APPOINTMENTS).find((doc) => (doc._id as ObjectId).equals(idOf(n)))!;

describe('012 backfillAssigneeIds (FR-30)', () => {
  it('FR-30: lịch cũ chỉ có assigneeId thì assigneeIds = [assigneeId]; assigneeId giữ nguyên', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: userA }),
    ]);

    const { backfilled: count } = await backfillAssigneeIds(fake.db);

    expect(count).toBe(1);
    expect(byId(fake, 1).assigneeIds).toEqual([userA]);
    expect(byId(fake, 1).assigneeId).toEqual(userA);
  });

  it('FR-30: lịch không có assigneeId (hoặc null) thì assigneeIds = [] (rỗng thật, không lỗi)', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1),
      appointment(2, { assigneeId: null }),
    ]);

    await backfillAssigneeIds(fake.db);

    expect(byId(fake, 1).assigneeIds).toEqual([]);
    expect(byId(fake, 2).assigneeIds).toEqual([]);
  });

  it('FR-30: lịch đã có assigneeIds (do BE mới ghi kép) KHÔNG bị ghi đè, kể cả khi assigneeId lệch', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeIds: [userB, userA], assigneeId: userB }),
      appointment(2, { assigneeIds: [userB], assigneeId: userA }),
      appointment(3, { assigneeIds: [], assigneeId: userA }),
    ]);

    const { backfilled: count } = await backfillAssigneeIds(fake.db);

    expect(count).toBe(0);
    expect(byId(fake, 1).assigneeIds).toEqual([userB, userA]);
    expect(byId(fake, 2).assigneeIds).toEqual([userB]);
    expect(byId(fake, 3).assigneeIds).toEqual([]);
  });

  it('FR-30: assigneeIds = null (không hợp lệ) được xử lý như thiếu', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeIds: null, assigneeId: userA }),
    ]);
    await backfillAssigneeIds(fake.db);
    expect(byId(fake, 1).assigneeIds).toEqual([userA]);
  });

  it('FR-30: IDEMPOTENT: chạy lần hai không đổi gì và không ghi nữa', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: userA }),
      appointment(2),
      appointment(3, { assigneeIds: [userB], assigneeId: userB }),
    ]);
    await backfillAssigneeIds(fake.db);
    const afterFirst = fake.snapshot();
    const writesAfterFirst = fake.writeCalls;

    const second = await backfillAssigneeIds(fake.db);

    expect(second).toEqual({ backfilled: 0, skipped: 0 });
    expect(fake.snapshot()).toEqual(afterFirst);
    expect(fake.writeCalls).toBe(writesAfterFirst);
  });

  it('FR-30: nhiều lô (hơn một lô 500) đều được điền đủ', async () => {
    const fake = new FakeMongo().seed(
      APPOINTMENTS,
      Array.from({ length: 1203 }, (_, i) =>
        appointment(i + 1, { assigneeId: userA }),
      ),
    );

    const { backfilled: count } = await backfillAssigneeIds(fake.db);

    expect(count).toBe(1203);
    expect(
      fake.all(APPOINTMENTS).every((doc) => {
        const ids = doc.assigneeIds as ObjectId[];
        return ids.length === 1 && ids[0].equals(userA);
      }),
    ).toBe(true);
  });

  it('FR-30: assigneeId là chuỗi 24 hex hợp lệ thì ép thành ObjectId', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: String(userA) }),
    ]);

    const stats = await backfillAssigneeIds(fake.db);

    expect(stats).toEqual({ backfilled: 1, skipped: 0 });
    const ids = byId(fake, 1).assigneeIds as ObjectId[];
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBeInstanceOf(ObjectId);
    expect(ids[0].equals(userA)).toBe(true);
  });

  it('FR-30: assigneeId hỏng (chuỗi sai, số, object) thì BỎ QUA bản ghi, KHÔNG ghi [] và log cảnh báo', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: 'khong-hop-le' }),
      appointment(2, { assigneeId: 12345 }),
      appointment(3, { assigneeId: 'abcdefabcdef' }),
      appointment(4, { assigneeId: userA }),
    ]);
    const lines: string[] = [];

    const stats = await backfillAssigneeIds(fake.db, (l) => lines.push(l));

    expect(stats).toEqual({ backfilled: 1, skipped: 3 });
    expect(byId(fake, 1)).not.toHaveProperty('assigneeIds');
    expect(byId(fake, 2)).not.toHaveProperty('assigneeIds');
    expect(byId(fake, 3)).not.toHaveProperty('assigneeIds');
    expect(byId(fake, 1).assigneeId).toBe('khong-hop-le');
    expect(byId(fake, 4).assigneeIds).toEqual([userA]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('CẢNH BÁO');
    expect(lines[0]).toContain(String(idOf(1)));
  });

  it('FR-30: bản ghi hỏng không chặn các lô sau (hơn một lô toàn bản ghi hỏng đứng trước)', async () => {
    const broken = Array.from({ length: 600 }, (_, i) =>
      appointment(i + 1, { assigneeId: 'hong' }),
    );
    const good = Array.from({ length: 10 }, (_, i) =>
      appointment(1000 + i, { assigneeId: userA }),
    );
    const fake = new FakeMongo().seed(APPOINTMENTS, [...broken, ...good]);

    const stats = await backfillAssigneeIds(fake.db);

    expect(stats).toEqual({ backfilled: 10, skipped: 600 });
    expect(byId(fake, 1000).assigneeIds).toEqual([userA]);
  });

  it('FR-30: chạy lại sau khi có bản ghi hỏng vẫn idempotent (không ghi gì thêm)', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: 'hong' }),
      appointment(2, { assigneeId: userA }),
    ]);
    await backfillAssigneeIds(fake.db);
    const afterFirst = fake.snapshot();
    const writes = fake.writeCalls;

    const second = await backfillAssigneeIds(fake.db);

    expect(second).toEqual({ backfilled: 0, skipped: 1 });
    expect(fake.snapshot()).toEqual(afterFirst);
    expect(fake.writeCalls).toBe(writes);
  });

  it('FR-30: collection rỗng không lỗi, không ghi', async () => {
    const fake = new FakeMongo();
    expect(await backfillAssigneeIds(fake.db)).toEqual({
      backfilled: 0,
      skipped: 0,
    });
    expect(fake.writeCalls).toBe(0);
  });
});

/** Db giả chỉ cho `indexes()` và `createIndex()` (FakeMongo không mô phỏng index). */
const dbWithIndexes = (
  indexes: Array<Record<string, unknown>> | 'missing-collection',
) => {
  const createIndex = jest.fn().mockResolvedValue('ok');
  const collection = {
    indexes: jest.fn(() =>
      indexes === 'missing-collection'
        ? Promise.reject(
            Object.assign(new Error('ns not found'), {
              code: MONGO_NAMESPACE_NOT_FOUND,
            }),
          )
        : Promise.resolve(indexes),
    ),
    createIndex,
  };
  return { db: { collection: () => collection } as unknown as Db, createIndex };
};

describe('012 ensureAssigneeIdsIndex (FR-30)', () => {
  it('FR-30: chưa có thì tạo index { assigneeIds: 1, startAt: 1 }, giữ index cũ { assigneeId, startAt }', async () => {
    const { db, createIndex } = dbWithIndexes([
      { name: '_id_', key: { _id: 1 } },
      { name: 'assigneeId_1_startAt_1', key: { assigneeId: 1, startAt: 1 } },
    ]);

    expect(await ensureAssigneeIdsIndex(db)).toBe(true);

    expect(createIndex).toHaveBeenCalledTimes(1);
    expect(createIndex).toHaveBeenCalledWith(
      { assigneeIds: 1, startAt: 1 },
      { name: 'assigneeIds_1_startAt_1' },
    );
  });

  it('FR-30: IDEMPOTENT: đã có index cùng khóa (kể cả do Mongoose autoIndex) thì không tạo lại', async () => {
    const { db, createIndex } = dbWithIndexes([
      { name: 'assigneeIds_1_startAt_1', key: { assigneeIds: 1, startAt: 1 } },
    ]);
    expect(await ensureAssigneeIdsIndex(db)).toBe(false);
    expect(createIndex).not.toHaveBeenCalled();
  });

  it('FR-30: index khóa khác thứ tự không bị coi là trùng', async () => {
    const { db, createIndex } = dbWithIndexes([
      { name: 'x', key: { startAt: 1, assigneeIds: 1 } },
    ]);
    expect(await ensureAssigneeIdsIndex(db)).toBe(true);
    expect(createIndex).toHaveBeenCalledTimes(1);
  });

  it('FR-30: collection chưa tồn tại (DB mới) thì coi như chưa có index và tạo', async () => {
    const { db, createIndex } = dbWithIndexes('missing-collection');
    expect(await ensureAssigneeIdsIndex(db)).toBe(true);
    expect(createIndex).toHaveBeenCalledTimes(1);
  });
});

/** Bọc `FakeMongo.db`: `indexes()` trả rỗng và `createIndex` là mock (FakeMongo chưa mô phỏng index). */
const withIndexStubs = (
  fake: FakeMongo,
): { db: Db; createIndex: jest.Mock } => {
  const createIndex = jest.fn().mockResolvedValue('ok');
  const db = {
    collection: (name: string) => {
      const base = fake.db.collection(name) as unknown as Record<
        string,
        unknown
      >;
      return Object.assign(Object.create(base), {
        indexes: () => Promise.resolve([]),
        createIndex,
      }) as never;
    },
  } as unknown as Db;
  return { db, createIndex };
};

describe('012 backfillAppointmentAssigneeIds: ghép hai bước (FR-30)', () => {
  it('FR-30: điền dữ liệu rồi tạo index, ghi một dòng log; trả kết quả', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: userA }),
    ]);
    const { db, createIndex } = withIndexStubs(fake);
    const lines: string[] = [];

    const result = await backfillAppointmentAssigneeIds(db, (l) =>
      lines.push(l),
    );

    expect(result).toEqual({
      backfilled: 1,
      skipped: 0,
      indexCreated: true,
    });
    expect(byId(fake, 1).assigneeIds).toEqual([userA]);
    expect(createIndex).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('1 lịch');
  });

  it('FR-30: có bản ghi hỏng thì kết quả và dòng log tổng kết nêu số bị bỏ qua', async () => {
    const fake = new FakeMongo().seed(APPOINTMENTS, [
      appointment(1, { assigneeId: 'hong' }),
      appointment(2, { assigneeId: userA }),
    ]);
    const { db } = withIndexStubs(fake);
    const lines: string[] = [];

    const result = await backfillAppointmentAssigneeIds(db, (l) =>
      lines.push(l),
    );

    expect(result).toMatchObject({ backfilled: 1, skipped: 1 });
    expect(lines.some((l) => l.includes('bỏ qua 1 lịch'))).toBe(true);
  });
});
