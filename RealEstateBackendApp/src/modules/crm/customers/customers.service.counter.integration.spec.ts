/**
 * INTEGRATION — cấp `customerCode` (FR-07) trong transaction tạo khách trên MongoDB Replica Set thật
 * (mongodb-memory-server): `CustomersService.create` thật + `CounterService` thật + `withTransaction` thật.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`). Không cần Redis.
 *
 * Chứng minh hai điều của Architecture 5.1:
 * (1) tạo song song vẫn cấp mã liên tục, không trùng;
 * (2) transaction rollback kéo theo cả `$inc` counter nên mã không bị thủng/nhảy cóc và không bị cấp lại cho hai khách.
 */
import mongoose, { Connection, Model, Types } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import {
  Counter,
  CounterSchema,
} from '../../../shared/counters/counter.schema';
import { CounterService } from '../../../shared/counters/counter.service';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { CrmActor } from '../common/access/crm-actor';
import {
  COUNTER_KEY,
  CUSTOMER_CODE_INDEX,
  formatCustomerCode,
} from './customer-code.constants';
import { CustomersService } from './customers.service';
import type { CreateCustomerDto } from './dtos/customer-request.dto';

jest.setTimeout(240_000);

const FAIL_PREFIX = 'FAIL-';
const jwt = { sub: 'u1' } as unknown as JwtPayload;

const emptyRefMaps = () => ({
  statuses: new Map(),
  sources: new Map(),
  areas: new Map(),
  projects: new Map(),
  contactResults: new Map(),
  tags: new Map(),
  users: new Map(),
  codes: {
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
  },
});

describe('CustomersService.create cấp customerCode trên Mongo thật (FR-07)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let customers: Model<Record<string, unknown>>;
  let counterModel: Model<Counter>;
  let counters: CounterService;
  let service: CustomersService;
  let dbCounter = 0;

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
  });

  afterAll(async () => {
    await replSet?.stop();
  });

  /** Mỗi test một database riêng để counter và customers độc lập. */
  beforeEach(async () => {
    dbCounter += 1;
    connection = await mongoose
      .createConnection(replSet.getUri(), { dbName: `custcode_${dbCounter}` })
      .asPromise();
    counterModel = connection.model<Counter>(Counter.name, CounterSchema);
    customers = connection.model<Record<string, unknown>>(
      'CustomerLoose',
      new mongoose.Schema({}, { strict: false, collection: 'customers' }),
    );
    // Cùng index partial unique như migration 010 / schema khách: chốt chặn cuối nếu cấp trùng mã.
    await customers.collection.createIndex(
      CUSTOMER_CODE_INDEX.key,
      CUSTOMER_CODE_INDEX.options,
    );
    // Collection phải tồn tại trước khi mở transaction ghi (không phụ thuộc phiên bản server).
    await counterModel.createCollection();
    await customers.createCollection().catch(() => undefined);

    counters = new CounterService(counterModel);
    service = buildService();
  });

  afterEach(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  const buildService = (): CustomersService => {
    const actor: CrmActor = {
      userId: new Types.ObjectId(),
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN],
      displayName: 'Admin',
      teamId: null,
      teamIds: [],
      managedTeamIds: [],
    };
    const userModel = {
      updateMany: () => ({ exec: () => Promise.resolve({}) }),
      findOne: () => {
        const query = {
          select: () => query,
          session: () => query,
          lean: () => query,
          exec: () => Promise.resolve({ _id: actor.userId, teamIds: [] }),
        };
        return query;
      },
    };
    const repo = {
      insert: async (doc: Record<string, unknown>, session: never) => {
        await customers.create([doc], { session });
      },
    };
    const refs = {
      resolveSingleInput: () => Promise.resolve({ provided: false, ref: null }),
      resolveListInput: () => Promise.resolve({ provided: false, refs: [] }),
      findDefaultStatusRef: () =>
        Promise.resolve({
          id: new Types.ObjectId(),
          code: 'NEW',
          label: 'Chưa tiếp cận',
        }),
      lockAndAssert: () => Promise.resolve(),
      resolve: () => Promise.resolve(emptyRefMaps()),
    };
    // Audit giả lập lỗi SAU khi đã cấp mã và insert (tệ nhất cho counter): tên khách bắt đầu bằng FAIL-.
    const audit = {
      record: (entry: { changes?: Array<{ field: string; to?: unknown }> }) => {
        const name = entry.changes?.find((c) => c.field === 'fullName')?.to;
        return typeof name === 'string' && name.startsWith(FAIL_PREFIX)
          ? Promise.reject(new Error('audit lỗi giữa transaction'))
          : Promise.resolve();
      },
    };
    const created = new CustomersService(
      connection,
      userModel as never,
      repo as never,
      { resolve: () => Promise.resolve({ actor, scope: {} }) } as never,
      refs as never,
      audit as never,
      { encrypt: jest.fn() } as never,
      { applyDelta: () => Promise.resolve() } as never,
      { dispatch: () => Promise.resolve() } as never,
      counters,
    );
    jest
      .spyOn(created, 'toDetailDto')
      .mockImplementation((doc) => Promise.resolve(doc as never));
    return created;
  };

  const dto = (fullName: string): CreateCustomerDto => ({
    fullName,
    phone: '0912345678',
  });

  const seqOf = async (): Promise<number> =>
    (await counterModel.findById(COUNTER_KEY).lean().exec())?.seq ?? 0;

  const storedCodes = async (): Promise<string[]> =>
    (await customers.find({}, { customerCode: 1 }).lean().exec())
      .map((doc) => doc.customerCode as string)
      .sort();

  const expectedCodes = (count: number): string[] =>
    Array.from({ length: count }, (_unused, index) =>
      formatCustomerCode(index + 1),
    );

  it('FR-07: tạo khách đầu tiên (counter chưa có doc) => KH-000001, counter seq = 1', async () => {
    const created = await service.create(jwt, dto('Khách đầu'));
    expect((created as unknown as Record<string, unknown>).customerCode).toBe(
      'KH-000001',
    );
    expect(await seqOf()).toBe(1);
  });

  it('FR-07: 20 lần tạo SONG SONG => 20 mã khác nhau, liên tục KH-000001..KH-000020, counter seq = 20', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        service.create(jwt, dto(`Khách ${index}`)),
      ),
    );
    const codes = await storedCodes();
    expect(new Set(codes).size).toBe(20);
    expect(codes).toEqual(expectedCodes(20));
    expect(await seqOf()).toBe(20);
  });

  it('FR-07: tạo lỗi sau khi đã cấp mã => rollback cả $inc: counter không nhảy, không có khách mồ côi, lần sau không thủng số', async () => {
    await service.create(jwt, dto('Khách 1'));
    await service.create(jwt, dto('Khách 2'));
    expect(await seqOf()).toBe(2);

    await expect(service.create(jwt, dto(`${FAIL_PREFIX}1`))).rejects.toThrow(
      'audit lỗi giữa transaction',
    );
    expect(await seqOf()).toBe(2);
    expect(await customers.countDocuments()).toBe(2);

    const next = await service.create(jwt, dto('Khách 3'));
    expect((next as unknown as Record<string, unknown>).customerCode).toBe(
      'KH-000003',
    );
    expect(await storedCodes()).toEqual(expectedCodes(3));
  });

  it('FR-07: song song 12 lần tạo, 4 lần lỗi giữa chừng => 8 khách thành công mang đúng KH-000001..KH-000008, không trùng, không thủng, seq = 8', async () => {
    const names = Array.from({ length: 12 }, (_unused, index) =>
      index % 3 === 2 ? `${FAIL_PREFIX}${index}` : `Khách ${index}`,
    );
    const results = await Promise.allSettled(
      names.map((name) => service.create(jwt, dto(name))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(8);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);

    const codes = await storedCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes).toEqual(expectedCodes(8));
    expect(await seqOf()).toBe(8);
    expect(
      await customers.countDocuments({
        fullName: { $regex: `^${FAIL_PREFIX}` },
      }),
    ).toBe(0);
  });

  it('FR-02: hai khách cùng SĐT tạo song song đều thành công (không còn chặn trùng), mã khác nhau', async () => {
    await Promise.all([
      service.create(jwt, dto('Giống SĐT 1')),
      service.create(jwt, dto('Giống SĐT 2')),
    ]);
    const docs = await customers.find().lean().exec();
    expect(docs.map((d) => d.phone)).toEqual(['+84912345678', '+84912345678']);
    expect(new Set(docs.map((d) => d.customerCode)).size).toBe(2);
  });

  describe('CounterService.next trên Mongo thật', () => {
    it("FR-07: returnDocument 'after': lần đầu (upsert) trả seq SAU khi tăng, không phải null/0", async () => {
      const range = await withTransaction(connection, (session) =>
        counters.next(COUNTER_KEY, 1, session),
      );
      expect(range).toEqual({ first: 1, last: 1 });
    });

    it('FR-07: cấp lô 5 mã => khoảng liên tục first..last, lần cấp kế tiếp nối đúng sau last', async () => {
      const batch = await withTransaction(connection, (session) =>
        counters.next(COUNTER_KEY, 5, session),
      );
      expect(batch).toEqual({ first: 1, last: 5 });
      const single = await withTransaction(connection, (session) =>
        counters.next(COUNTER_KEY, 1, session),
      );
      expect(single).toEqual({ first: 6, last: 6 });
      expect(await seqOf()).toBe(6);
    });

    it('FR-07: transaction abort sau khi cấp lô => seq quay về giá trị cũ, lô được cấp lại nguyên vẹn', async () => {
      await withTransaction(connection, (session) =>
        counters.next(COUNTER_KEY, 3, session),
      );
      await expect(
        withTransaction(connection, async (session) => {
          await counters.next(COUNTER_KEY, 4, session);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(await seqOf()).toBe(3);
      const again = await withTransaction(connection, (session) =>
        counters.next(COUNTER_KEY, 4, session),
      );
      expect(again).toEqual({ first: 4, last: 7 });
    });

    it('FR-07: index partial unique chặn cứng mã trùng (chốt chặn cuối nếu counter bị chỉnh tay lùi lại)', async () => {
      await service.create(jwt, dto('Khách 1'));
      await counterModel.updateOne({ _id: COUNTER_KEY }, { $set: { seq: 0 } });
      await expect(service.create(jwt, dto('Khách 2'))).rejects.toMatchObject({
        code: 11000,
      });
      expect(await customers.countDocuments()).toBe(1);
      expect(await seqOf()).toBe(0);
    });
  });
});
