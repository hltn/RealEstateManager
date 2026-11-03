/**
 * INTEGRATION — probe baseline 002..006 trên MongoDB thật (mongodb-memory-server, bản đơn lẻ đủ vì probe chỉ đọc).
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { createHash } from 'crypto';
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  BREAKERS,
  seedProductionLikeDb,
  snapshotDb,
} from '../production-like-db.fixture';
import { BASELINE_MIGRATION_IDS } from '../system.constants';
import { BASELINE_PROBES, runBaselineProbes } from './index';
import { createProbe002UrlHash, probe002UrlHash } from './probe-002-urlhash';
import { probe003DriveTtl } from './probe-003-drive-ttl';
import { probe004UserTeamId } from './probe-004-user-team-id';
import { probe005UserRoles } from './probe-005-user-roles';
import { probe006Areas } from './probe-006-areas';

jest.setTimeout(240_000);

describe('baseline probes (002..006)', () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let counter = 0;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  const newDb = (): Db => {
    counter += 1;
    return client.db(`probe_${counter}`);
  };

  describe('production giả đã đủ dữ liệu', () => {
    it('đủ 5 probe đạt, đúng thứ tự id, counts toàn số, KHÔNG ghi gì vào DB', async () => {
      const db = newDb();
      await seedProductionLikeDb(db);
      const before = await snapshotDb(db);

      const results = await runBaselineProbes(db, BASELINE_MIGRATION_IDS);

      expect(results.map((r) => r.id)).toEqual([...BASELINE_MIGRATION_IDS]);
      expect(results.every((r) => r.passed)).toBe(true);
      for (const { counts } of results) {
        expect(Object.values(counts).every(Number.isFinite)).toBe(true);
      }
      // Số đếm thật khớp dữ liệu đã dựng (không phải hằng số tautology).
      expect(results[0].counts).toMatchObject({
        raw_articles_scanned: 2,
        news_articles_scanned: 2,
        raw_articles_hashMismatch: 0,
      });
      expect(results[4].counts).toMatchObject({
        provincesKept: 34,
        provincesInserted: 0,
      });
      expect(await snapshotDb(db)).toEqual(before);
    });

    it('danh sách BASELINE_PROBES khớp BASELINE_MIGRATION_IDS và id lạ bị từ chối', async () => {
      expect(BASELINE_PROBES.map((p) => p.id)).toEqual([
        ...BASELINE_MIGRATION_IDS,
      ]);
      await expect(runBaselineProbes(newDb(), ['999_x'])).rejects.toThrow(
        '999_x',
      );
    });

    it.each(Object.keys(BREAKERS))(
      'chỉ probe %s fail khi dữ liệu còn việc; 4 probe còn lại vẫn đạt; vẫn không ghi gì',
      async (brokenId) => {
        const db = newDb();
        await seedProductionLikeDb(db);
        await BREAKERS[brokenId](db);
        const before = await snapshotDb(db);

        const results = await runBaselineProbes(db, BASELINE_MIGRATION_IDS);

        expect(results.filter((r) => !r.passed).map((r) => r.id)).toEqual([
          brokenId,
        ]);
        expect(await snapshotDb(db)).toEqual(before);
      },
    );
  });

  describe('probe 002 (urlHash)', () => {
    const md5 = (v: string) => createHash('md5').update(v).digest('hex');
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');

    it('collection chưa tồn tại: đạt và KHÔNG tạo collection', async () => {
      const db = newDb();
      const result = await probe002UrlHash.run(db);
      expect(result.passed).toBe(true);
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });

    it('MD5 ở news_articles cũng làm fail; đếm đúng số lệch', async () => {
      const db = newDb();
      await db.collection('news_articles').insertMany([
        { url: 'https://x.test/1', urlHash: md5('https://x.test/1') },
        { url: 'https://x.test/2', urlHash: md5('https://x.test/2') },
        { url: 'https://x.test/3', urlHash: sha('https://x.test/3') },
      ]);
      const result = await probe002UrlHash.run(db);
      expect(result.passed).toBe(false);
      expect(result.counts.news_articles_hashMismatch).toBe(2);
      expect(result.counts.raw_articles_hashMismatch).toBe(0);
    });

    it('url trùng (cùng hash đúng) làm fail dù mọi hash đều SHA-256', async () => {
      const db = newDb();
      await db.collection('raw_articles').insertMany([
        { url: 'https://dup.test', urlHash: sha('https://dup.test') },
        { url: 'https://dup.test', urlHash: sha('https://dup.test') },
      ]);
      const result = await probe002UrlHash.run(db);
      expect(result.passed).toBe(false);
      expect(result.counts.raw_articles_duplicateUrls).toBe(1);
      expect(result.counts.raw_articles_hashMismatch).toBe(0);
    });

    it('doc thiếu/rỗng url: chỉ cảnh báo, không chặn; thiếu urlHash của doc có url thì fail', async () => {
      const db = newDb();
      await db
        .collection('raw_articles')
        .insertMany([
          { title: 'không url' },
          { url: '   ', urlHash: 'x' },
          { url: 'https://ok.test', urlHash: sha('https://ok.test') },
        ]);
      const ok = await probe002UrlHash.run(db);
      expect(ok.passed).toBe(true);
      expect(ok.counts.raw_articles_missingUrl).toBe(2);
      expect(ok.warnings.join(' ')).toContain('raw_articles');

      await db
        .collection('raw_articles')
        .insertOne({ url: 'https://nohash.test' });
      expect((await probe002UrlHash.run(db)).passed).toBe(false);
    });
  });

  describe('probe 002: trần quét (không xác minh được thì FAIL, không bỏ qua âm thầm)', () => {
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    const seedArticles = async (db: Db, count: number) => {
      await db.collection('raw_articles').insertMany(
        Array.from({ length: count }, (_, i) => ({
          url: `https://cap.test/${i}`,
          urlHash: sha(`https://cap.test/${i}`),
        })),
      );
    };

    it('vượt trần số doc: passed=false, unverifiable=1, lý do "không xác minh được", dù dữ liệu sạch', async () => {
      const db = newDb();
      await seedArticles(db, 5);
      const probe = createProbe002UrlHash({
        maxDocsPerCollection: 3,
        maxDurationMs: 60_000,
      });
      const result = await probe.run(db);
      expect(result.passed).toBe(false);
      expect(result.counts.unverifiable).toBe(1);
      expect(result.counts.raw_articles_scanned).toBe(3);
      expect(result.reason).toContain('không xác minh được');
      expect(result.reason).toContain('raw_articles');
    });

    it('đúng bằng trần (5 doc, trần 5): vẫn quét hết và đạt', async () => {
      const db = newDb();
      await seedArticles(db, 5);
      const result = await createProbe002UrlHash({
        maxDocsPerCollection: 5,
        maxDurationMs: 60_000,
      }).run(db);
      expect(result.passed).toBe(true);
      expect(result.counts.unverifiable).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it('trần thời gian tính bằng mili giây: đồng hồ giả đúng bằng hạn (+100ms) thì vẫn quét, vượt 1ms thì dừng', async () => {
      const db = newDb();
      await seedArticles(db, 5);
      // Lần gọi đầu = mốc bắt đầu (1000) => hạn = 1000 + 100 = 1100. Hai doc đầu thấy đúng 1100 (chưa vượt), doc thứ 3 thấy 1101.
      const readings = [1000, 1100, 1100, 1101];
      let calls = 0;
      const clock = () => readings[Math.min(calls++, readings.length - 1)];

      const result = await createProbe002UrlHash(
        { maxDocsPerCollection: 1000, maxDurationMs: 100 },
        clock,
      ).run(db);

      expect(result.passed).toBe(false);
      expect(result.counts.raw_articles_scanned).toBe(2);
      expect(result.counts.unverifiable).toBe(1);
      expect(result.reason).toContain('không xác minh được');
      expect(result.reason).toContain('100 ms');
    });

    it('đồng hồ giả chạy chậm hơn trần (không bao giờ vượt hạn): quét hết và đạt', async () => {
      const db = newDb();
      await seedArticles(db, 5);
      const result = await createProbe002UrlHash(
        { maxDocsPerCollection: 1000, maxDurationMs: 100 },
        () => 1000,
      ).run(db);
      expect(result.passed).toBe(true);
      expect(result.counts.raw_articles_scanned).toBe(5);
    });

    it('probe mặc định không chạm trần với dữ liệu nhỏ và phát hiện url trùng bằng khóa gọn (không dương tính giả)', async () => {
      const db = newDb();
      await seedArticles(db, 50);
      expect((await probe002UrlHash.run(db)).passed).toBe(true);
      await db.collection('raw_articles').insertOne({
        url: 'https://cap.test/7',
        urlHash: sha('https://cap.test/7'),
      });
      const result = await probe002UrlHash.run(db);
      expect(result.passed).toBe(false);
      expect(result.counts.raw_articles_duplicateUrls).toBe(1);
    });
  });

  describe('probe 003 (TTL googledrivetokens)', () => {
    it('collection chưa tồn tại: đạt, không tạo collection', async () => {
      const db = newDb();
      const result = await probe003DriveTtl.run(db);
      expect(result).toMatchObject({ passed: true, counts: { ttlIndexes: 0 } });
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });

    it('TTL index khóa expiresAt: fail, đếm 1', async () => {
      const db = newDb();
      await db
        .collection('googledrivetokens')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      const result = await probe003DriveTtl.run(db);
      expect(result.passed).toBe(false);
      expect(result.counts.ttlIndexes).toBe(1);
    });

    it('index expiresAt KHÔNG TTL và TTL trên field khác: đạt', async () => {
      const db = newDb();
      const tokens = db.collection('googledrivetokens');
      await tokens.createIndex({ expiresAt: 1 });
      await tokens.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 });
      expect((await probe003DriveTtl.run(db)).passed).toBe(true);
    });
  });

  describe('probe 004 (users.teamId)', () => {
    it('users rỗng/không tồn tại: đạt', async () => {
      expect((await probe004UserTeamId.run(newDb())).passed).toBe(true);
    });

    it('user thiếu teamId: fail; teamId null thì đạt; thiếu index chỉ cảnh báo (missingIndex=1)', async () => {
      const db = newDb();
      const users = db.collection('users');
      await users.insertOne({ email: 'a@x.test', teamId: null });
      const ok = await probe004UserTeamId.run(db);
      expect(ok.passed).toBe(true);
      expect(ok.counts).toEqual({ missingTeamId: 0, missingIndex: 1 });
      expect(ok.warnings).toHaveLength(1);

      await users.createIndex({ teamId: 1, status: 1 });
      expect((await probe004UserTeamId.run(db)).counts.missingIndex).toBe(0);

      await users.insertOne({ email: 'b@x.test' });
      const bad = await probe004UserTeamId.run(db);
      expect(bad.passed).toBe(false);
      expect(bad.counts.missingTeamId).toBe(1);
    });
  });

  describe('probe 005 (roles/teamIds)', () => {
    it('roles null, roles rỗng, thiếu teamIds đều là còn việc (fail)', async () => {
      for (const doc of [
        { role: 'STAFF', roles: null, teamIds: [] },
        { role: 'STAFF', roles: [], teamIds: [] },
        { role: 'STAFF', roles: ['STAFF'] },
        { role: 'STAFF', teamIds: [] },
      ]) {
        const db = newDb();
        await db.collection('users').insertOne({ ...doc, teamId: null });
        const result = await probe005UserRoles.run(db);
        expect([JSON.stringify(doc), result.passed]).toEqual([
          JSON.stringify(doc),
          false,
        ]);
        expect(result.counts.pendingUsers).toBe(1);
      }
    });

    it('lệch cặp role/teamId đơn chỉ cảnh báo (vẫn đạt) và đếm drift', async () => {
      const db = newDb();
      await db.collection('users').insertOne({
        role: 'STAFF',
        roles: ['MANAGER'],
        teamId: 't1',
        teamIds: ['t1'],
      });
      const result = await probe005UserRoles.run(db);
      expect(result.passed).toBe(true);
      expect(result.counts).toEqual({ pendingUsers: 0, drift: 1 });
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('probe 006 (34 tỉnh)', () => {
    it('DB chưa có khu vực nào: còn việc (cần chèn 34 tỉnh) => fail', async () => {
      const result = await probe006Areas.run(newDb());
      expect(result.passed).toBe(false);
      expect(result.counts.provincesInserted).toBe(34);
    });

    it('khách trỏ khu vực không tồn tại => fail (customersCleared=1)', async () => {
      const db = newDb();
      await seedProductionLikeDb(db);
      await db.collection('customers').insertOne({ areaId: new ObjectId() });
      const result = await probe006Areas.run(db);
      expect(result.passed).toBe(false);
      expect(result.counts.customersCleared).toBe(1);
    });
  });
});
