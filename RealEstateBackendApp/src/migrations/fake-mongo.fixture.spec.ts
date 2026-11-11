/**
 * UNIT — tự kiểm `FakeMongo` (fixture dùng chung của spec runner/bù mã). Fixture sai thì mọi spec dựa vào nó xanh giả,
 * nên các hành vi nó hứa ở đầu file (lọc/sort thật, rollback thật, NÉM LỖI khi gặp thứ không mô phỏng đúng) đều có test
 * kiểm GIÁ TRỊ ở đây.
 */
import { MongoServerError, ObjectId } from 'mongodb';
import { FakeMongo } from './fake-mongo.fixture';
import type { FakeDoc } from './fake-mongo.fixture';

const COL = 'items';

const idOf = (n: number): ObjectId =>
  new ObjectId(n.toString(16).padStart(24, '0'));

const ids = (docs: FakeDoc[]): unknown[] => docs.map((doc) => doc._id);

describe('FakeMongo', () => {
  describe('lọc ($type, $not, $exists, $ne, $in, $gt, $regex, $or)', () => {
    const seeded = (): FakeMongo =>
      new FakeMongo().seed(COL, [
        { _id: 'thieu' },
        { _id: 'null', code: null },
        { _id: 'so', code: 12345 },
        { _id: 'chuoi', code: 'KH-000001' },
      ]);

    it('$type string chỉ khớp giá trị chuỗi (không khớp thiếu trường, null, số)', async () => {
      const found = await seeded()
        .collection(COL)
        .find({ code: { $type: 'string' } })
        .toArray();

      expect(ids(found)).toEqual(['chuoi']);
    });

    it('$not + $type: khớp thiếu trường, null và số (phần bù của $type string)', async () => {
      const found = await seeded()
        .collection(COL)
        .find({ code: { $not: { $type: 'string' } } })
        .toArray();

      expect(ids(found)).toEqual(['thieu', 'null', 'so']);
    });

    it('$type khác "string" ném lỗi thay vì trả kết quả sai', () => {
      expect(() =>
        seeded()
          .collection(COL)
          .find({ code: { $type: 'int' } }),
      ).toThrow('$type chưa hỗ trợ: int');
    });

    it('$exists / $ne null / $in / $gt / $regex / $or đúng ngữ nghĩa Mongo', async () => {
      const fake = new FakeMongo().seed(COL, [
        { _id: 'a', n: 1, s: 'abc', d: null },
        { _id: 'b', n: 5, s: 'xyz' },
        { _id: 'c', n: 9, s: 'abd', d: new Date(5) },
      ]);
      const col = fake.collection(COL);
      const idsOf = async (filter: Record<string, unknown>) =>
        ids(await col.find(filter).toArray());

      expect(await idsOf({ d: { $exists: true } })).toEqual(['a', 'c']);
      // `$ne: null` loại cả trường null lẫn trường thiếu.
      expect(await idsOf({ d: { $ne: null } })).toEqual(['c']);
      expect(await idsOf({ n: { $in: [1, 9] } })).toEqual(['a', 'c']);
      expect(await idsOf({ n: { $gt: 4 } })).toEqual(['b', 'c']);
      expect(await idsOf({ s: { $regex: '^ab' } })).toEqual(['a', 'c']);
      expect(await idsOf({ $or: [{ n: 1 }, { s: 'xyz' }] })).toEqual([
        'a',
        'b',
      ]);
    });

    it('ObjectId và Date so bằng theo giá trị, không theo tham chiếu', async () => {
      const fake = new FakeMongo().seed(COL, [
        { _id: idOf(1), at: new Date(1000) },
        { _id: idOf(2), at: new Date(2000) },
      ]);

      const byId = await fake
        .collection(COL)
        .findOne({ _id: new ObjectId(idOf(2).toHexString()) });
      const byDate = await fake
        .collection(COL)
        .countDocuments({ at: new Date(1000) });

      expect(byId?._id).toEqual(idOf(2));
      expect(byDate).toBe(1);
    });

    it.each([
      [{ code: { $nin: ['a'] } }, 'Toán tử chưa hỗ trợ trong FakeMongo: $nin'],
      [{ $and: [{ code: 1 }] }, 'Toán tử cấp cao chưa hỗ trợ: $and'],
      [
        { 'a.b': 1 },
        'Khóa filter có dấu chấm chưa hỗ trợ trong FakeMongo: a.b',
      ],
    ])('filter %j không mô phỏng được: ném lỗi', (filter, message) => {
      expect(() => seeded().collection(COL).find(filter)).toThrow(message);
    });
  });

  describe('sort / limit', () => {
    it('thiếu trường hoặc null xếp TRƯỚC khi tăng dần, ngược lại khi giảm dần', async () => {
      const col = new FakeMongo()
        .seed(COL, [
          { _id: 'c', createdAt: new Date(3000) },
          { _id: 'thieu' },
          { _id: 'a', createdAt: new Date(1000) },
          { _id: 'null', createdAt: null },
        ])
        .collection(COL);

      const asc = await col.find().sort({ createdAt: 1 }).toArray();
      const desc = await col.find().sort({ createdAt: -1 }).toArray();

      expect(ids(asc)).toEqual(['thieu', 'null', 'a', 'c']);
      expect(ids(desc)).toEqual(['c', 'a', 'thieu', 'null']);
    });

    it('khóa thứ hai làm tie-break; ObjectId so theo hex; limit cắt sau khi sort', async () => {
      const same = new Date(1000);
      const col = new FakeMongo()
        .seed(COL, [
          { _id: idOf(5), createdAt: same },
          { _id: idOf(3), createdAt: same },
          { _id: idOf(9), createdAt: new Date(500) },
        ])
        .collection(COL);

      const sorted = await col
        .find()
        .sort({ createdAt: 1, _id: 1 })
        .limit(2)
        .toArray();

      expect(ids(sorted)).toEqual([idOf(9), idOf(3)]);
    });

    it('async iterator duyệt đúng thứ tự đã sort', async () => {
      const col = new FakeMongo()
        .seed(COL, [
          { _id: 'b', n: 2 },
          { _id: 'a', n: 1 },
        ])
        .collection(COL);
      const seen: unknown[] = [];

      for await (const doc of col.find().sort({ n: 1 })) seen.push(doc._id);

      expect(seen).toEqual(['a', 'b']);
    });

    it('kết quả là bản sao: sửa tài liệu đọc ra không đổi "DB"', async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 1 }]);

      const [doc] = await fake.collection(COL).find().toArray();
      doc.n = 999;

      expect(fake.all(COL)[0].n).toBe(1);
    });
  });

  describe('transaction giả lập (rollback)', () => {
    const transact = async <T>(
      fake: FakeMongo,
      work: () => Promise<T>,
    ): Promise<T> => {
      const session = fake.client.startSession();
      try {
        return await session.withTransaction(work);
      } finally {
        await session.endSession();
      }
    };

    it('callback thành công: thay đổi được giữ và trả về giá trị của callback', async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 1 }]);

      const result = await transact(fake, async () => {
        await fake.collection(COL).updateOne({ _id: 'a' }, { $set: { n: 2 } });
        return 'xong';
      });

      expect(result).toBe('xong');
      expect(fake.all(COL)).toEqual([{ _id: 'a', n: 2 }]);
    });

    it('callback ném lỗi: rollback mọi ghi (cập nhật, chèn, xóa) và ném lại đúng lỗi đó', async () => {
      const fake = new FakeMongo().seed(COL, [
        { _id: 'a', n: 1 },
        { _id: 'b', n: 1 },
      ]);
      const before = fake.snapshot();

      await expect(
        transact(fake, async () => {
          await fake
            .collection(COL)
            .updateOne({ _id: 'a' }, { $set: { n: 2 } });
          await fake.collection(COL).insertOne({ _id: 'c', n: 3 });
          await fake.collection(COL).deleteOne({ _id: 'b' });
          throw new Error('hỏng giữa chừng');
        }),
      ).rejects.toThrow('hỏng giữa chừng');

      expect(fake.snapshot()).toEqual(before);
    });

    it('thay đổi của hook beforeTransaction (tiến trình khác) KHÔNG bị rollback; call đếm từ 1', async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 1 }]);
      const calls: number[] = [];
      fake.hooks.beforeTransaction = ({ call }) => {
        calls.push(call);
        fake.docsOf(COL)[0].n = 77;
      };

      await expect(
        transact(fake, () => Promise.reject(new Error('x'))),
      ).rejects.toThrow('x');
      await expect(
        transact(fake, () => Promise.reject(new Error('y'))),
      ).rejects.toThrow('y');

      expect(calls).toEqual([1, 2]);
      expect(fake.all(COL)[0].n).toBe(77);
    });
  });

  describe('update: thứ không mô phỏng đúng thì ném lỗi, không ghi sai im lặng', () => {
    it('$set khóa có dấu chấm ném lỗi và KHÔNG ghi một khóa chứa dấu chấm', () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', profile: {} }]);

      expect(() =>
        fake
          .collection(COL)
          .updateOne({ _id: 'a' }, { $set: { 'profile.name': 'x' } }),
      ).toThrow(/Khóa có dấu chấm chưa hỗ trợ.*profile\.name/);

      expect(fake.all(COL)).toEqual([{ _id: 'a', profile: {} }]);
    });

    it('khóa có dấu chấm cũng bị từ chối ở $inc/$max, bulkWrite và upsert (upsert không để lại tài liệu dở)', () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 1 }]);
      const col = fake.collection(COL);

      expect(() => col.updateOne({ _id: 'a' }, { $inc: { 'x.y': 1 } })).toThrow(
        'Khóa có dấu chấm',
      );
      expect(() => col.updateOne({ _id: 'a' }, { $max: { 'x.y': 1 } })).toThrow(
        'Khóa có dấu chấm',
      );
      expect(() =>
        col.bulkWrite([
          {
            updateOne: { filter: { _id: 'a' }, update: { $set: { 'x.y': 1 } } },
          },
        ]),
      ).toThrow('Khóa có dấu chấm');
      expect(() =>
        col.updateOne({ _id: 'moi' }, { $set: { 'x.y': 1 } }, { upsert: true }),
      ).toThrow('Khóa có dấu chấm');

      expect(fake.all(COL)).toEqual([{ _id: 'a', n: 1 }]);
    });

    it('toán tử update lạ ném lỗi (kể cả khi upsert và khi danh sách trường rỗng), không tạo tài liệu', () => {
      const fake = new FakeMongo();
      const col = fake.collection(COL);

      expect(() =>
        col.updateOne({ _id: 'a' }, { $push: { xs: 1 } }, { upsert: true }),
      ).toThrow('Toán tử update chưa hỗ trợ: $push');
      expect(() => col.updateOne({ _id: 'a' }, { $unset: {} })).toThrow(
        'Toán tử update chưa hỗ trợ: $unset',
      );

      expect(fake.all(COL)).toEqual([]);
    });

    it('$inc/$max lên trường không phải số hoặc toán hạng không phải số ném lỗi, giữ nguyên giá trị cũ', () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', seq: 'abc' }]);
      const col = fake.collection(COL);

      expect(() => col.updateOne({ _id: 'a' }, { $inc: { seq: 1 } })).toThrow(
        '$inc chỉ hỗ trợ số',
      );
      expect(() => col.updateOne({ _id: 'a' }, { $max: { seq: 1 } })).toThrow(
        '$max chỉ hỗ trợ số',
      );
      expect(() => col.updateOne({ _id: 'a' }, { $inc: { n: '1' } })).toThrow(
        '$inc chỉ hỗ trợ số',
      );

      expect(fake.all(COL)).toEqual([{ _id: 'a', seq: 'abc' }]);
    });

    it('$inc/$max/$set đúng ngữ nghĩa: thiếu trường coi như 0/-vô cực; modifiedCount chỉ 1 khi giá trị đổi', async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 5 }]);
      const col = fake.collection(COL);

      const inc = await col.updateOne({ _id: 'a' }, { $inc: { n: 2, m: 3 } });
      const maxLower = await col.updateOne({ _id: 'a' }, { $max: { n: 1 } });
      const maxHigher = await col.updateOne({ _id: 'a' }, { $max: { n: 50 } });
      const setSame = await col.updateOne({ _id: 'a' }, { $set: { n: 50 } });
      const noMatch = await col.updateOne({ _id: 'zzz' }, { $set: { n: 1 } });

      expect(inc.modifiedCount).toBe(1);
      expect(maxLower.modifiedCount).toBe(0);
      expect(maxHigher.modifiedCount).toBe(1);
      expect(setSame.modifiedCount).toBe(0);
      expect(noMatch.modifiedCount).toBe(0);
      expect(fake.all(COL)).toEqual([{ _id: 'a', n: 50, m: 3 }]);
    });

    it('upsert tạo tài liệu mang điều kiện bằng-giá-trị của filter rồi áp update', async () => {
      const fake = new FakeMongo();

      const result = await fake
        .collection(COL)
        .updateOne({ _id: 'k' }, { $inc: { seq: 4 } }, { upsert: true });

      expect(result.modifiedCount).toBe(1);
      expect(fake.all(COL)).toEqual([{ _id: 'k', seq: 4 }]);
    });
  });

  describe('findOneAndUpdate (returnDocument)', () => {
    it("'after' trả tài liệu SAU khi cập nhật", async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'k', seq: 5 }]);

      const doc = await fake
        .collection(COL)
        .findOneAndUpdate(
          { _id: 'k' },
          { $inc: { seq: 3 } },
          { returnDocument: 'after' },
        );

      expect(doc).toEqual({ _id: 'k', seq: 8 });
      expect(fake.all(COL)).toEqual([{ _id: 'k', seq: 8 }]);
    });

    it("'before' và khi không truyền (mặc định của driver) trả tài liệu TRƯỚC khi cập nhật, DB vẫn được cập nhật", async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'k', seq: 5 }]);
      const col = fake.collection(COL);

      const explicit = await col.findOneAndUpdate(
        { _id: 'k' },
        { $inc: { seq: 3 } },
        { returnDocument: 'before' },
      );
      const byDefault = await col.findOneAndUpdate(
        { _id: 'k' },
        { $inc: { seq: 1 } },
      );

      expect(explicit).toEqual({ _id: 'k', seq: 5 });
      expect(byDefault).toEqual({ _id: 'k', seq: 8 });
      expect(fake.all(COL)).toEqual([{ _id: 'k', seq: 9 }]);
    });

    it("upsert: 'after' trả tài liệu mới tạo, 'before' trả null (trước đó chưa có)", async () => {
      const fake = new FakeMongo();
      const col = fake.collection(COL);

      const before = await col.findOneAndUpdate(
        { _id: 'a' },
        { $inc: { seq: 2 } },
        { upsert: true, returnDocument: 'before' },
      );
      const after = await col.findOneAndUpdate(
        { _id: 'b' },
        { $inc: { seq: 2 } },
        { upsert: true, returnDocument: 'after' },
      );

      expect(before).toBeNull();
      expect(after).toEqual({ _id: 'b', seq: 2 });
    });

    it('không khớp và không upsert: trả null, không tạo tài liệu', async () => {
      const fake = new FakeMongo();

      const doc = await fake
        .collection(COL)
        .findOneAndUpdate(
          { _id: 'x' },
          { $inc: { seq: 1 } },
          { returnDocument: 'after' },
        );

      expect(doc).toBeNull();
      expect(fake.all(COL)).toEqual([]);
    });

    it("'after' phản ánh đúng khi update đổi chính trường trong filter (không tra lại bằng filter cũ)", async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'k', state: 'cho' }]);

      const doc = await fake
        .collection(COL)
        .findOneAndUpdate(
          { state: 'cho' },
          { $set: { state: 'xong' } },
          { returnDocument: 'after' },
        );

      expect(doc).toEqual({ _id: 'k', state: 'xong' });
    });
  });

  describe('ghi, đếm lần ghi, snapshot', () => {
    it('insertOne trùng _id ném MongoServerError code 11000 (vẫn tính một lần ghi)', async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a' }]);

      const failure = await fake
        .collection(COL)
        .insertOne({ _id: 'a' })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(MongoServerError);
      expect((failure as MongoServerError).code).toBe(11000);
      expect(fake.writeCalls).toBe(1);
      expect(fake.all(COL)).toHaveLength(1);
    });

    it('seed và các thao tác đọc không tính vào writeCalls; mỗi thao tác ghi tính đúng một lần', async () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 1 }]);
      const col = fake.collection(COL);

      await col.find().toArray();
      await col.findOne({ _id: 'a' });
      await col.countDocuments();
      expect(fake.writeCalls).toBe(0);

      await col.insertOne({ _id: 'b' });
      await col.updateOne({ _id: 'a' }, { $set: { n: 2 } });
      await col.findOneAndUpdate({ _id: 'a' }, { $set: { n: 3 } });
      await col.replaceOne({ _id: 'b' }, { _id: 'b', n: 9 });
      await col.bulkWrite([
        { updateOne: { filter: { _id: 'a' }, update: { $set: { n: 4 } } } },
      ]);
      await col.deleteOne({ _id: 'b' });
      expect(fake.writeCalls).toBe(6);
    });

    it('snapshot bỏ collection rỗng (chỉ đọc collection chưa có không phải thay đổi) và restore khôi phục đúng', () => {
      const fake = new FakeMongo().seed(COL, [{ _id: 'a', n: 1 }]);
      fake.docsOf('trong');
      const snapshot = fake.snapshot();

      fake.docsOf(COL)[0].n = 2;
      fake.restore(snapshot);

      expect(Object.keys(snapshot)).toEqual([COL]);
      expect(fake.all(COL)).toEqual([{ _id: 'a', n: 1 }]);
    });

    it('db.admin().command trả setName theo cấu hình (null = không phải replica set)', async () => {
      const replica = await new FakeMongo('rs9').db.admin().command({});
      const standalone = await new FakeMongo(null).db.admin().command({});

      expect(replica).toEqual({ setName: 'rs9' });
      expect(standalone).toEqual({});
    });
  });

  describe('aggregate', () => {
    it('$match + $group($sum) + $match + $count đếm đúng số nhóm có total > 1; stage lạ ném lỗi', async () => {
      const col = new FakeMongo()
        .seed(COL, [
          { _id: 1, code: 'A' },
          { _id: 2, code: 'A' },
          { _id: 3, code: 'B' },
          { _id: 4, code: 'C' },
          { _id: 5, code: 'C' },
          { _id: 6, code: 'C' },
          { _id: 7, code: null },
        ])
        .collection(COL);

      const rows = await col
        .aggregate([
          { $match: { code: { $type: 'string' } } },
          { $group: { _id: '$code', total: { $sum: 1 } } },
          { $match: { total: { $gt: 1 } } },
          { $count: 'duplicates' },
        ])
        .toArray();
      const none = await col
        .aggregate([{ $match: { code: 'ZZ' } }, { $count: 'n' }])
        .toArray();

      expect(rows).toEqual([{ duplicates: 2 }]);
      expect(none).toEqual([]);
      expect(() => col.aggregate([{ $lookup: {} }])).toThrow(
        'Stage aggregate chưa hỗ trợ: $lookup',
      );
    });
  });
});
