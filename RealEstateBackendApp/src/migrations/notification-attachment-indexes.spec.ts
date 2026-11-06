import type { Db } from 'mongodb';
import {
  createNotificationAttachmentIndexes,
  dropNotificationAttachmentIndexes,
  NOTIFICATION_ATTACHMENT_INDEXES,
} from './notification-attachment-indexes';
import { MIGRATIONS } from './migration.registry';
import { migration009NotificationAttachmentIndexes } from './versions/009_notification_attachment_indexes';

interface FakeCollection {
  indexExists: jest.Mock;
  createIndex: jest.Mock;
  dropIndex: jest.Mock;
}

const NOTI = 'notifications';
const ATT = 'crm_attachments';

const mongoError = (code: number): Error =>
  Object.assign(new Error('mongo'), { code });

/** Db giả: mỗi collection một bộ mock; `existing` = tập "collection.tên" đã có index. */
const fakeDb = (existing: string[] = []) => {
  const collections = new Map<string, FakeCollection>();
  const get = (name: string): FakeCollection => {
    let c = collections.get(name);
    if (!c) {
      c = {
        indexExists: jest.fn((index: string) =>
          Promise.resolve(existing.includes(`${name}.${index}`)),
        ),
        createIndex: jest.fn().mockResolvedValue('ok'),
        dropIndex: jest.fn().mockResolvedValue({ ok: 1 }),
      };
      collections.set(name, c);
    }
    return c;
  };
  const db = { collection: get } as unknown as Db;
  return { db, get, collections };
};

describe('migration 009 notification_attachment_indexes', () => {
  it('định nghĩa đúng hai index theo Architecture 5.1.10', () => {
    expect(NOTIFICATION_ATTACHMENT_INDEXES).toEqual([
      {
        collection: NOTI,
        name: 'pushStatus_1_createdAt_1',
        keys: { pushStatus: 1, createdAt: 1 },
        partialFilterExpression: { pushStatus: 'PENDING' },
      },
      {
        collection: ATT,
        name: 'thumbStatus_1_createdAt_1',
        keys: { thumbStatus: 1, createdAt: 1 },
        // MongoDB không cho $ne trong partialFilterExpression.
        partialFilterExpression: { thumbStatus: { $in: ['NONE', 'FAILED'] } },
      },
    ]);
  });

  describe('up (apply)', () => {
    it('tạo cả hai index với tên + partialFilterExpression đúng', async () => {
      const { db, get } = fakeDb();
      const result = await createNotificationAttachmentIndexes(db, true);
      expect(get(NOTI).createIndex).toHaveBeenCalledWith(
        { pushStatus: 1, createdAt: 1 },
        {
          name: 'pushStatus_1_createdAt_1',
          partialFilterExpression: { pushStatus: 'PENDING' },
        },
      );
      expect(get(ATT).createIndex).toHaveBeenCalledWith(
        { thumbStatus: 1, createdAt: 1 },
        {
          name: 'thumbStatus_1_createdAt_1',
          partialFilterExpression: { thumbStatus: { $in: ['NONE', 'FAILED'] } },
        },
      );
      expect(result.created).toHaveLength(2);
      expect(result.existing).toEqual([]);
    });

    it('chạy lại khi index đã có: không tạo lại, không lỗi', async () => {
      const { db, collections } = fakeDb([
        `${NOTI}.pushStatus_1_createdAt_1`,
        `${ATT}.thumbStatus_1_createdAt_1`,
      ]);
      const result = await createNotificationAttachmentIndexes(db, true);
      expect(result.created).toEqual([]);
      expect(result.existing).toHaveLength(2);
      for (const c of collections.values()) {
        expect(c.createIndex).not.toHaveBeenCalled();
      }
    });

    it('chỉ tạo index còn thiếu', async () => {
      const { db, get } = fakeDb([`${NOTI}.pushStatus_1_createdAt_1`]);
      const result = await createNotificationAttachmentIndexes(db, true);
      expect(result.created).toEqual([`${ATT}.thumbStatus_1_createdAt_1`]);
      expect(get(NOTI).createIndex).not.toHaveBeenCalled();
      expect(get(ATT).createIndex).toHaveBeenCalledTimes(1);
    });

    it('collection chưa tồn tại (NamespaceNotFound khi kiểm index): coi như chưa có và tạo', async () => {
      const { db, get } = fakeDb();
      get(NOTI).indexExists.mockRejectedValue(mongoError(26));
      const result = await createNotificationAttachmentIndexes(db, true);
      expect(result.created).toContain(`${NOTI}.pushStatus_1_createdAt_1`);
      expect(get(NOTI).createIndex).toHaveBeenCalledTimes(1);
    });

    it('lỗi Mongo khác khi kiểm index thì ném ra', async () => {
      const { db, get } = fakeDb();
      get(NOTI).indexExists.mockRejectedValue(mongoError(13));
      await expect(
        createNotificationAttachmentIndexes(db, true),
      ).rejects.toThrow('mongo');
    });
  });

  describe('dry-run (apply=false)', () => {
    it('chỉ liệt kê index sẽ tạo, KHÔNG gọi createIndex', async () => {
      const { db, collections } = fakeDb();
      const logs: string[] = [];
      const result = await createNotificationAttachmentIndexes(db, false, (m) =>
        logs.push(m),
      );
      expect(result.created).toHaveLength(2);
      for (const c of collections.values()) {
        expect(c.createIndex).not.toHaveBeenCalled();
      }
      expect(logs[0]).toContain('Dry-run');
    });
  });

  describe('down', () => {
    it('gỡ đúng hai index theo tên, không gọi gì khác', async () => {
      const { db, get } = fakeDb();
      const dropped = await dropNotificationAttachmentIndexes(db);
      expect(dropped).toEqual([
        `${NOTI}.pushStatus_1_createdAt_1`,
        `${ATT}.thumbStatus_1_createdAt_1`,
      ]);
      expect(get(NOTI).dropIndex).toHaveBeenCalledTimes(1);
      expect(get(NOTI).dropIndex).toHaveBeenCalledWith(
        'pushStatus_1_createdAt_1',
      );
      expect(get(ATT).dropIndex).toHaveBeenCalledTimes(1);
      expect(get(ATT).dropIndex).toHaveBeenCalledWith(
        'thumbStatus_1_createdAt_1',
      );
    });

    it('index/collection không tồn tại (27/26): bỏ qua, chạy lại không lỗi', async () => {
      const { db, get } = fakeDb();
      get(NOTI).dropIndex.mockRejectedValue(mongoError(27));
      get(ATT).dropIndex.mockRejectedValue(mongoError(26));
      await expect(dropNotificationAttachmentIndexes(db)).resolves.toEqual([]);
    });

    it('lỗi Mongo khác thì ném ra', async () => {
      const { db, get } = fakeDb();
      get(NOTI).dropIndex.mockRejectedValue(mongoError(13));
      await expect(dropNotificationAttachmentIndexes(db)).rejects.toThrow(
        'mongo',
      );
    });
  });

  describe('đăng ký vào runner', () => {
    it('có trong registry, sau 007 và 008, có up và down', () => {
      expect(MIGRATIONS.map((m) => m.id)).toEqual([
        '007_crm_catalog_codes',
        '008_crm_project_property_type_codes',
        '009_notification_attachment_indexes',
      ]);
      expect(MIGRATIONS[2]).toBe(migration009NotificationAttachmentIndexes);
      expect(typeof migration009NotificationAttachmentIndexes.up).toBe(
        'function',
      );
      expect(typeof migration009NotificationAttachmentIndexes.down).toBe(
        'function',
      );
    });

    it('up/down của migration gọi đúng logic với db từ context', async () => {
      const { db, get } = fakeDb();
      const log = jest.fn();
      const context = { client: {} as never, db, log };
      await migration009NotificationAttachmentIndexes.up(context);
      expect(get(NOTI).createIndex).toHaveBeenCalledTimes(1);
      expect(get(ATT).createIndex).toHaveBeenCalledTimes(1);
      await migration009NotificationAttachmentIndexes.down!(context);
      expect(get(NOTI).dropIndex).toHaveBeenCalledTimes(1);
      expect(get(ATT).dropIndex).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(2);
    });
  });
});
