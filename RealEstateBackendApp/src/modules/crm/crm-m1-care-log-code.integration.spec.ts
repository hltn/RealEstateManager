/**
 * INTEGRATION (T-11, FR-40): `care_logs.contactResultCode` trên MongoDB thật (mongodb-memory-server).
 * Chạy bằng lệnh tích hợp của dự án; không cần Redis/MinIO vì chỉ dựng kết nối + schema, không dựng cả ứng dụng.
 */
import mongoose, { Connection, Model, Types } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import {
  CareLog,
  CareLogDocument,
  CareLogSchema,
} from './care-logs/schemas/care-log.schema';
import { CrmUsageService } from './common/crm-usage.service';

jest.setTimeout(180_000);

describe('FR-40 T-11: care_logs.contactResultCode (Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let model: Model<CareLogDocument>;
  let usage: CrmUsageService;

  const resultId = new Types.ObjectId();
  const CODE = 'KHONG_NGHE_MAY';

  /** Nhật ký thô qua driver (giữ nguyên hình dạng dữ liệu trước/sau migration, không qua default của Mongoose). */
  const rawLog = (extra: Record<string, unknown>) => ({
    customerId: new Types.ObjectId(),
    authorId: new Types.ObjectId(),
    authorName: 'Hạnh',
    occurredAt: new Date(),
    content: 'Gọi lần 1',
    contactChannel: 'CALL',
    deletedAt: null,
    ...extra,
  });

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    model = connection.model<CareLogDocument>(CareLog.name, CareLogSchema);
    await model.init();
    usage = new CrmUsageService(connection);
  });

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('care_logs').deleteMany({});
  });

  it('FR-40: collection care_logs có chỉ mục sparse { contactResultCode: 1 }', async () => {
    const indexes = await connection.collection('care_logs').indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { contactResultCode: 1 },
        sparse: true,
      }),
    );
  });

  it('FR-40: ghi qua model lưu cả id lẫn code, không có code thì lưu null', async () => {
    const [withResult, without] = await model.create([
      { ...rawLog({}), contactResultId: resultId, contactResultCode: CODE },
      rawLog({}),
    ]);

    const rows = await model
      .find({ _id: { $in: [withResult._id, without._id] } })
      .lean()
      .exec();

    const byId = (id: Types.ObjectId) => rows.find((row) => row._id.equals(id));
    expect(byId(withResult._id)).toMatchObject({
      contactResultId: resultId,
      contactResultCode: CODE,
    });
    expect(byId(without._id)).toMatchObject({
      contactResultId: null,
      contactResultCode: null,
    });
  });

  describe('countCareLogsByContactResult: đếm theo id HOẶC code trên nhật ký thiếu code', () => {
    it('FR-40: nhật ký chỉ có id (thiếu contactResultCode, hình dạng v1.0.3) vẫn được đếm', async () => {
      await connection
        .collection('care_logs')
        .insertOne(rawLog({ contactResultId: resultId }));

      expect(await usage.countCareLogsByContactResult(resultId, CODE)).toBe(1);
    });

    it('FR-40: nhật ký chỉ có code (thiếu id) vẫn được đếm', async () => {
      await connection
        .collection('care_logs')
        .insertOne(rawLog({ contactResultCode: CODE }));

      expect(await usage.countCareLogsByContactResult(resultId, CODE)).toBe(1);
    });

    it('FR-40: nhật ký có cả hai chỉ đếm một lần; nhật ký đã xóa mềm và của kết quả khác không đếm', async () => {
      await connection.collection('care_logs').insertMany([
        rawLog({ contactResultId: resultId, contactResultCode: CODE }),
        rawLog({
          contactResultId: resultId,
          contactResultCode: CODE,
          deletedAt: new Date(),
        }),
        rawLog({
          contactResultId: new Types.ObjectId(),
          contactResultCode: 'KHAC',
        }),
        rawLog({}),
      ]);

      expect(await usage.countCareLogsByContactResult(resultId, CODE)).toBe(1);
    });

    it('FR-40: không truyền code (danh mục cũ) thì chỉ đếm theo id', async () => {
      await connection
        .collection('care_logs')
        .insertMany([
          rawLog({ contactResultCode: CODE }),
          rawLog({ contactResultId: resultId }),
        ]);

      expect(await usage.countCareLogsByContactResult(resultId)).toBe(1);
    });
  });
});
