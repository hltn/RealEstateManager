import { createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { normalizeVietnamese } from '../modules/crm/common/utils/vietnamese-text.util';
import {
  provinceSeedKey,
  SEED_PROVINCES,
} from '../modules/crm/seed/crm-seed.data';

/**
 * Fixture CHỈ DÙNG CHO TEST: dựng một database "giống production 1.0.2" (đã chạy tay 002..006, `system` còn trống):
 * users đã có roles/teamIds/teamId, 34 tỉnh đúng chuẩn, bài viết đã băm SHA-256 không trùng, không TTL index ở
 * `googledrivetokens`. Dữ liệu giả hoàn toàn (không PII thật).
 */
const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const md5 = (value: string): string =>
  createHash('md5').update(value).digest('hex');

export const seedProductionLikeDb = async (db: Db): Promise<void> => {
  await db.collection('users').insertMany([
    {
      email: 'admin@example.test',
      role: 'ADMIN',
      roles: ['ADMIN'],
      status: 'ACTIVE',
      teamId: null,
      teamIds: [],
    },
    {
      email: 'staff@example.test',
      role: 'STAFF',
      roles: ['STAFF'],
      status: 'ACTIVE',
      teamId: 'team-a',
      teamIds: ['team-a'],
    },
  ]);

  const areas = SEED_PROVINCES.map((name, index) => ({
    _id: new ObjectId(),
    name,
    nameNormalized: normalizeVietnamese(name),
    type: 'PROVINCE',
    parentId: null,
    ancestorIds: [],
    adminCode: null,
    isLegacy: false,
    order: index + 1,
    isActive: true,
    seedKey: provinceSeedKey(name),
    deletedAt: null,
  }));
  await db.collection('areas').insertMany(areas);
  await db.collection('customers').insertOne({
    areaId: areas[0]._id,
    deletedAt: null,
  });

  for (const name of ['raw_articles', 'news_articles']) {
    await db.collection(name).insertMany(
      ['https://example.test/a', 'https://example.test/b'].map((url) => ({
        url,
        urlHash: sha256(url),
      })),
    );
  }
  // Collection token có tồn tại nhưng chỉ có index `_id` mặc định (TTL đã được drop).
  await db.collection('googledrivetokens').insertOne({ userId: 'u1' });
};

/** Mỗi hàm làm ĐÚNG MỘT probe không đạt trên DB đã `seedProductionLikeDb` (id = migration cũ mà probe kiểm). */
export const BREAKERS: Record<string, (db: Db) => Promise<unknown>> = {
  '002_recompute_urlhash_sha256': (db) =>
    db.collection('raw_articles').insertOne({
      url: 'https://example.test/old-md5',
      urlHash: md5('https://example.test/old-md5'),
    }),
  '003_drop_googledrivetokens_ttl_index': (db) =>
    db
      .collection('googledrivetokens')
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  '004_users_add_team_id': (db) =>
    db.collection('users').insertOne({
      email: 'old@example.test',
      role: 'EDITOR',
      roles: ['EDITOR'],
      teamIds: [],
      status: 'ACTIVE',
    }),
  '005_users_roles_teamids': (db) =>
    db.collection('users').insertOne({
      email: 'norole@example.test',
      role: 'EDITOR',
      roles: null,
      teamId: null,
      teamIds: [],
      status: 'ACTIVE',
    }),
  '006_areas_34_provinces': (db) =>
    db.collection('areas').insertOne({
      name: 'Quận 7',
      nameNormalized: 'quan 7',
      type: 'DISTRICT',
      parentId: new ObjectId(),
      ancestorIds: [],
      order: 999,
      seedKey: 'AREA:old/quan 7',
      isLegacy: false,
      deletedAt: null,
    }),
};

/** Ảnh chụp trạng thái toàn DB (tên collection, toàn bộ document, tên index) để chứng minh "không ghi gì". */
export const snapshotDb = async (
  db: Db,
): Promise<Record<string, { docs: unknown[]; indexes: string[] }>> => {
  const result: Record<string, { docs: unknown[]; indexes: string[] }> = {};
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  for (const { name } of collections) {
    const collection = db.collection(name);
    result[name] = {
      docs: await collection.find({}).sort({ _id: 1 }).toArray(),
      indexes: (await collection.listIndexes().toArray())
        .map((index) => String(index.name))
        .sort(),
    };
  }
  return result;
};
