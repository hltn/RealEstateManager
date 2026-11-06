/**
 * INTEGRATION — chứng minh MongoDB transaction chạy trên Replica Set.
 *
 * Cần mongod thật nên KHÔNG chạy trong `npm test`; chạy bằng `npm run test:integration`.
 * Dùng mongodb-memory-server ở chế độ replica set (lần đầu tự tải binary mongod về cache).
 */
import mongoose, { Connection, InferSchemaType, Model, Schema } from 'mongoose';
import { MongoServerError } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from './memory-replset.util';
import { registerAfterCommit } from './after-commit.util';
import { withTransaction } from './with-transaction.util';

jest.setTimeout(180_000);

const customerSchema = new Schema({ name: String });
const auditSchema = new Schema({ customerName: String });

describe('withTransaction (MongoDB Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;

  let Customer: Model<InferSchemaType<typeof customerSchema>>;
  let Audit: Model<InferSchemaType<typeof auditSchema>>;

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    Customer = connection.model('Customer', customerSchema);
    Audit = connection.model('Audit', auditSchema);
    // Collection phải tồn tại trước transaction đa-collection (MongoDB 4.x/5.x yêu cầu).
    await Customer.createCollection();
    await Audit.createCollection();
  });

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await Customer.deleteMany({});
    await Audit.deleteMany({});
  });

  it('commit: ghi 2 collection trong cùng transaction, cả hai đều thấy sau khi xong', async () => {
    const result = await withTransaction(connection, async (session) => {
      await Customer.create([{ name: 'An' }], { session });
      await Audit.create([{ customerName: 'An' }], { session });
      return 'done';
    });

    expect(result).toBe('done');
    expect(await Customer.countDocuments()).toBe(1);
    expect(await Audit.countDocuments()).toBe(1);
  });

  it('rollback: lỗi ở bước 2 thì bước 1 cũng bị hủy (không để dữ liệu nửa vời) và lỗi gốc được ném lại', async () => {
    const failure = new Error('ghi audit thất bại');

    await expect(
      withTransaction(connection, async (session) => {
        await Customer.create([{ name: 'Bình' }], { session });
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await Customer.countDocuments()).toBe(0);
  });

  it('cô lập: ngoài transaction chưa thấy dữ liệu chưa commit', async () => {
    let visibleOutside = -1;

    await withTransaction(connection, async (session) => {
      await Customer.create([{ name: 'Chi' }], { session });
      visibleOutside = await Customer.countDocuments();
    });

    expect(visibleOutside).toBe(0);
    expect(await Customer.countDocuments()).toBe(1);
  });

  it('FR-03 afterCommit: chỉ chạy sau commit và thấy dữ liệu đã commit', async () => {
    let seen = -1;
    await withTransaction(connection, async (session) => {
      await Customer.create([{ name: 'Dũng' }], { session });
      void registerAfterCommit(session, async () => {
        seen = await Customer.countDocuments();
      });
      expect(seen).toBe(-1);
    });

    expect(seen).toBe(1);
  });

  it('FR-03 afterCommit: rollback thì callback không chạy', async () => {
    const callback = jest.fn();
    await expect(
      withTransaction(connection, async (session) => {
        await Customer.create([{ name: 'Em' }], { session });
        void registerAfterCommit(session, callback);
        throw new Error('hủy');
      }),
    ).rejects.toThrow('hủy');

    expect(callback).not.toHaveBeenCalled();
    expect(await Customer.countDocuments()).toBe(0);
  });

  it('FR-03 afterCommit: retry work (TransientTransactionError) không chạy callback hai lần', async () => {
    const callback = jest.fn();
    let attempts = 0;
    await withTransaction(connection, async (session) => {
      attempts += 1;
      await Customer.create([{ name: 'Phúc' }], { session });
      void registerAfterCommit(session, callback);
      if (attempts === 1) {
        const transient = new MongoServerError({
          message: 'giả lập transient',
        });
        transient.addErrorLabel('TransientTransactionError');
        throw transient;
      }
    });

    expect(attempts).toBe(2);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(await Customer.countDocuments()).toBe(1);
  });

  it('FR-03 afterCommit: callback ném lỗi không làm hỏng dữ liệu đã commit', async () => {
    await expect(
      withTransaction(connection, async (session) => {
        await Customer.create([{ name: 'Giang' }], { session });
        void registerAfterCommit(session, () => {
          throw new Error('enqueue lỗi');
        });
        return 'ok';
      }),
    ).resolves.toBe('ok');

    expect(await Customer.countDocuments()).toBe(1);
  });
});
