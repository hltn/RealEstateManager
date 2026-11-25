// Seed DB GIẢ "production 1.0.2" cho staging local (chạy bằng mongosh TRONG container mongo, xác thực root từ biến môi trường
// của container). KHÔNG chứa dữ liệu thật. Trạng thái giống production trước lần deploy 1.0.3 đầu tiên: users đã migrate 005+004
// (roles[]/teamIds[]/teamId), 34 tỉnh (migration 006 xong), urlHash SHA-256 (002 xong), không TTL index trên googledrivetokens (003
// xong), collection `system` TRỐNG (chưa có version/sổ migration) => `deploy.sh` sẽ probe 002..006 rồi baseline.
// XÓA DB `realestate` trước khi nạp. Số bài viết: biến SEED_ARTICLES (mặc định 200 mỗi collection).
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const crypto = require('crypto');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const norm = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const PROVINCES = ['Hà Nội','Huế','Lai Châu','Điện Biên','Sơn La','Lạng Sơn','Quảng Ninh','Thanh Hóa','Nghệ An','Hà Tĩnh','Cao Bằng','Tuyên Quang','Lào Cai','Thái Nguyên','Phú Thọ','Bắc Ninh','Hưng Yên','Hải Phòng','Ninh Bình','Quảng Trị','Đà Nẵng','Quảng Ngãi','Gia Lai','Khánh Hòa','Lâm Đồng','Đắk Lắk','TP. Hồ Chí Minh','Đồng Nai','Tây Ninh','Cần Thơ','Vĩnh Long','Đồng Tháp','Cà Mau','An Giang'];
const ARTICLES = Number(process.env.SEED_ARTICLES || 200);
const d = db.getSiblingDB('realestate');
d.dropDatabase();
d.users.insertMany([
  { email: 'admin@example.test', role: 'ADMIN', roles: ['ADMIN'], status: 'ACTIVE', teamId: null, teamIds: [] },
  { email: 'staff@example.test', role: 'STAFF', roles: ['STAFF'], status: 'ACTIVE', teamId: 'team-a', teamIds: ['team-a'] },
  { email: 'staff2@example.test', role: 'STAFF', roles: ['STAFF'], status: 'ACTIVE', teamId: 'team-a', teamIds: ['team-a'] },
]);
d.users.createIndex({ teamId: 1, status: 1 });
const areas = PROVINCES.map((name, i) => ({ _id: new ObjectId(), name, nameNormalized: norm(name), type: 'PROVINCE', parentId: null, ancestorIds: [], adminCode: null, isLegacy: false, order: i + 1, isActive: true, seedKey: 'AREA:' + norm(name), deletedAt: null }));
d.areas.insertMany(areas);
d.customers.insertOne({ areaId: areas[0]._id, deletedAt: null });
for (const name of ['raw_articles', 'news_articles']) {
  const docs = [];
  for (let i = 0; i < ARTICLES; i++) { const url = `https://example.test/${name}/${i}`; docs.push({ url, urlHash: sha256(url), title: 'Bài ' + i }); }
  d.getCollection(name).insertMany(docs);
}
d.googledrivetokens.insertOne({ userId: 'u1' });
print('SEED_OK collections=' + d.getCollectionNames().sort().join(',') + ' users=' + d.users.countDocuments() + ' areas=' + d.areas.countDocuments());
