// Chụp (CHỈ ĐỌC) số document từng collection của DB dev `mongodb`, DBSIZE Redis db 0 và db 15, số object MinIO dev.
// Dùng để chứng minh E2E không đụng stack dev:  node e2e/tools/dev-snapshot.mjs > before.json  (chạy e2e)  rồi so sánh.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const be = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../RealEstateBackendApp/');
const req = createRequire(path.join(be, 'package.json'));
const { MongoClient } = req('mongodb');
const Redis = req('ioredis');
const { S3Client, ListObjectsV2Command, ListBucketsCommand } = req('@aws-sdk/client-s3');

const out = { mongo: {}, redis: {}, minio: {} };

const mc = new MongoClient('mongodb://localhost:27017/mongodb?directConnection=true', { serverSelectionTimeoutMS: 3000 });
await mc.connect();
const db = mc.db('mongodb');
for (const c of (await db.listCollections().toArray()).map((x) => x.name).sort()) out.mongo[c] = await db.collection(c).estimatedDocumentCount();
await mc.close();

for (const n of [0, 15]) {
  const r = new Redis({ host: '127.0.0.1', port: 6379, db: n, lazyConnect: true });
  await r.connect();
  out.redis[`db${n}`] = await r.dbsize();
  r.disconnect();
}

const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: process.env.E2E_S3_ACCESS_KEY_ID ?? 'minioadmin', secretAccessKey: process.env.E2E_S3_SECRET_ACCESS_KEY ?? 'minioadmin' },
});
try {
  for (const b of (await s3.send(new ListBucketsCommand({}))).Buckets ?? []) {
    if (b.Name.startsWith('e2e-')) continue;
    let n = 0, token;
    do { const r = await s3.send(new ListObjectsV2Command({ Bucket: b.Name, ContinuationToken: token })); n += r.KeyCount ?? 0; token = r.NextContinuationToken; } while (token);
    out.minio[b.Name] = n;
  }
} catch (e) { out.minio = { error: String(e.name) }; }

console.log(JSON.stringify(out, null, 1));
