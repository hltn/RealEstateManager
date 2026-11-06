/**
 * INTEGRATION — migration 009 (index notifications/crm_attachments, FR-03/FR-26) trên MongoDB Replica Set thật
 * (mongodb-memory-server). Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { MIGRATIONS } from './migration.registry';
import type { Migration } from './migration.types';

jest.setTimeout(240_000);

const NOTI_INDEX = 'pushStatus_1_createdAt_1';
const ATT_INDEX = 'thumbStatus_1_createdAt_1';

describe('migration 009_notification_attachment_indexes (Mongo thật)', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let dbCounter = 0;
  let migration009: Migration;

  beforeAll(async () => {
    const found = MIGRATIONS.find(
      (m) => m.id === '009_notification_attachment_indexes',
    );
    if (!found) throw new Error('009 chưa đăng ký trong registry');
    migration009 = found;
    replSet = await createMemoryReplSet();
    client = new MongoClient(replSet.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  const freshDb = (): Db => client.db(`mig009_${(dbCounter += 1)}`);
  const context = (db: Db) => ({ client, db, log: () => undefined });
  const down = (db: Db) => {
    if (!migration009.down) throw new Error('009 thiếu down');
    return migration009.down(context(db));
  };

  /** Dữ liệu cũ + một index khác sẵn có để kiểm `down` không gỡ nhầm. */
  const seed = async (db: Db) => {
    await db.collection('notifications').insertMany([
      { _id: new ObjectId(), pushStatus: 'PENDING', createdAt: new Date() },
      { _id: new ObjectId(), pushStatus: 'SKIPPED', createdAt: new Date() },
    ]);
    await db.collection('crm_attachments').insertMany([
      { _id: new ObjectId(), thumbStatus: 'NONE', createdAt: new Date() },
      { _id: new ObjectId(), thumbStatus: 'READY', createdAt: new Date() },
      { _id: new ObjectId(), createdAt: new Date() },
    ]);
    await db.collection('notifications').createIndex({ userId: 1, readAt: 1 });
    await db
      .collection('crm_attachments')
      .createIndex({ status: 1, createdAt: 1 });
  };

  const indexNames = async (db: Db, collection: string): Promise<string[]> =>
    (await db.collection(collection).indexes()).map((i) => String(i.name));

  it('up tạo đúng hai index partial; dữ liệu không đổi', async () => {
    const db = freshDb();
    await seed(db);
    const before = {
      notifications: await db.collection('notifications').find().toArray(),
      attachments: await db.collection('crm_attachments').find().toArray(),
    };
    await migration009.up(context(db));

    const noti = (await db.collection('notifications').indexes()).find(
      (i) => i.name === NOTI_INDEX,
    );
    expect(noti?.key).toEqual({ pushStatus: 1, createdAt: 1 });
    expect(noti?.partialFilterExpression).toEqual({ pushStatus: 'PENDING' });
    const att = (await db.collection('crm_attachments').indexes()).find(
      (i) => i.name === ATT_INDEX,
    );
    expect(att?.key).toEqual({ thumbStatus: 1, createdAt: 1 });
    expect(att?.partialFilterExpression).toEqual({
      thumbStatus: { $in: ['NONE', 'FAILED'] },
    });

    expect(await db.collection('notifications').find().toArray()).toEqual(
      before.notifications,
    );
    expect(await db.collection('crm_attachments').find().toArray()).toEqual(
      before.attachments,
    );
  });

  it('chạy lại lần hai: không lỗi, không tạo trùng', async () => {
    const db = freshDb();
    await seed(db);
    await migration009.up(context(db));
    const notiFirst = await indexNames(db, 'notifications');
    const attFirst = await indexNames(db, 'crm_attachments');
    await expect(migration009.up(context(db))).resolves.toBeUndefined();
    expect(await indexNames(db, 'notifications')).toEqual(notiFirst);
    expect(await indexNames(db, 'crm_attachments')).toEqual(attFirst);
  });

  it('chạy trên DB trống (collection chưa tồn tại): vẫn tạo index', async () => {
    const db = freshDb();
    await migration009.up(context(db));
    expect(await indexNames(db, 'notifications')).toContain(NOTI_INDEX);
    expect(await indexNames(db, 'crm_attachments')).toContain(ATT_INDEX);
  });

  it('down gỡ đúng hai index, giữ index khác và dữ liệu; chạy lại down không lỗi', async () => {
    const db = freshDb();
    await seed(db);
    await migration009.up(context(db));
    await down(db);

    const noti = await indexNames(db, 'notifications');
    const att = await indexNames(db, 'crm_attachments');
    expect(noti).not.toContain(NOTI_INDEX);
    expect(att).not.toContain(ATT_INDEX);
    expect(noti).toEqual(expect.arrayContaining(['_id_', 'userId_1_readAt_1']));
    expect(att).toEqual(
      expect.arrayContaining(['_id_', 'status_1_createdAt_1']),
    );
    expect(await db.collection('notifications').countDocuments()).toBe(2);
    expect(await db.collection('crm_attachments').countDocuments()).toBe(3);

    await expect(down(db)).resolves.toBeUndefined();
  });

  it('down trên DB chưa có collection: không lỗi', async () => {
    await expect(down(freshDb())).resolves.toBeUndefined();
  });

  it('up sau down tạo lại index (đi-lùi-đi)', async () => {
    const db = freshDb();
    await migration009.up(context(db));
    await down(db);
    await migration009.up(context(db));
    expect(await indexNames(db, 'notifications')).toContain(NOTI_INDEX);
  });
});
