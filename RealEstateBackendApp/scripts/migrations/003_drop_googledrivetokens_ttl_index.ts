/**
 * Migration 003 — Drop TTL index trên collection googledrivetokens.
 *
 * Bối cảnh: Schema GoogleDriveToken trước đây có TTL index
 * `{ expiresAt: 1 }, { expireAfterSeconds: 0 }`. Vì expiresAt được set theo
 * expiry của ACCESS token (sống ~1h), MongoDB tự xoá TOÀN BỘ document sau ~1h —
 * mất luôn refreshToken (sống dài hạn, dùng để auto-refresh). Hậu quả: user
 * phải reconnect Google Drive mỗi giờ.
 *
 * Fix: TTL index đã bị bỏ khỏi schema (google-drive-token.schema.ts). Nhưng
 * index đã tồn tại trong MongoDB vẫn tiếp tục xoá document cho tới khi bị drop
 * thủ công — Mongoose KHÔNG tự drop index đã xoá khỏi schema. Migration này
 * drop index đó.
 *
 * Backward Compatible: CÓ — chỉ drop index, không sửa data. Sau khi drop,
 * document token không còn bị auto-xoá; refresh token được giữ lại để
 * auto-refresh hoạt động đúng.
 *
 * Idempotent: dropIndex chỉ chạy khi index tồn tại (check listIndexes trước).
 * Chạy lại nhiều lần an toàn.
 *
 * Chạy:
 *   Dry-run (mặc định, không ghi):  npx ts-node scripts/migrations/003_drop_googledrivetokens_ttl_index.ts
 *   Dry-run tường minh:            npx ts-node scripts/migrations/003_drop_googledrivetokens_ttl_index.ts --dry-run
 *   Thực thi thật:                  npx ts-node scripts/migrations/003_drop_googledrivetokens_ttl_index.ts --apply
 *
 * Author: Neptune — 2026-08-26
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const COLLECTION = 'googledrivetokens';
const INDEX_NAME = 'expiresAt_1';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[003] ${msg}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;

  if (!uri) {
    log('ERROR: MONGODB_URI (hoặc MONGO_URI) chưa được set trong .env');
    process.exit(1);
  }

  log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  log(`Target: collection "${COLLECTION}", index "${INDEX_NAME}"`);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection(COLLECTION);

    // Check index tồn tại không (idempotent).
    const indexes = await collection.listIndexes().toArray();
    const ttlIndex = indexes.find(
      (idx) =>
        idx.name === INDEX_NAME ||
        (idx.key &&
          typeof idx.key === 'object' &&
          'expiresAt' in (idx.key as Record<string, unknown>) &&
          typeof idx.expireAfterSeconds === 'number'),
    );

    if (!ttlIndex) {
      log(`Index TTL trên "${COLLECTION}" không tồn tại — không cần làm gì. ✅`);
      return;
    }

    log(
      `Tìm thấy TTL index: name="${String(ttlIndex.name)}", ` +
        `expireAfterSeconds=${String(ttlIndex.expireAfterSeconds)}`,
    );

    if (!apply) {
      log('DRY-RUN: sẽ drop index này khi chạy với --apply.');
      return;
    }

    await collection.dropIndex(String(ttlIndex.name));
    log(`Đã drop index "${String(ttlIndex.name)}" thành công. ✅`);
    log(
      'Từ giờ document token không bị auto-xoá; refresh token được giữ lại để auto-refresh.',
    );
  } catch (err) {
    log(`ERROR: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await client.close();
  }
}

void main();
