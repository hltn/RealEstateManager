// Chụp "ảnh" CHỈ ĐỌC của DB `realestate` để so TRƯỚC/SAU khi diễn tập deploy bằng bản sao dump production (FR-21, Architecture 5.10).
// Chạy bằng mongosh TRONG container staging (rhstg_mongo) qua `bash scripts/staging.sh snapshot <nhãn>`; xác thực root từ biến môi trường
// của container (mật khẩu không lên dòng lệnh). KHÔNG ghi gì vào DB. KHÔNG in dữ liệu cá nhân: chỉ SỐ ĐẾM, spec index, và _id/trường vô hướng
// của doc `system` (version/sổ migration). Đầu ra stdout là ĐÚNG MỘT khối JSON (khóa sắp xếp ổn định) để `diff` được.
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB('realestate');
const names = d.getCollectionNames().sort();
const has = (n) => names.includes(n);
const count = (n, filter) => (has(n) ? d.getCollection(n).countDocuments(filter || {}) : null);
const sortObj = (o) => Object.keys(o).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {});

const snap = { database: 'realestate', collections: {}, customers: null, customerIndexes: null, counters: null, system: null };

// Số document mọi collection (estimated: nhanh, đủ để so lệch lớn; số khách bên dưới đếm chính xác).
for (const n of names.filter((x) => !x.startsWith('system.'))) snap.collections[n] = d.getCollection(n).estimatedDocumentCount();
snap.collections = sortObj(snap.collections);

if (has('customers')) {
  const c = d.customers;
  // SĐT trùng: nhóm theo phone dạng chuỗi, KHÔNG tính giá trị ẩn danh `anonymized:<id>` (mỗi khách một giá trị riêng, không phải trùng thật).
  const dupPhone = c.aggregate([
    { $match: { phone: { $type: 'string', $not: /^anonymized:/ } } },
    { $group: { _id: '$phone', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $group: { _id: null, groups: { $sum: 1 }, customers: { $sum: '$n' } } },
  ]).toArray()[0] || { groups: 0, customers: 0 };
  const dupCode = c.aggregate([
    { $match: { customerCode: { $type: 'string' } } },
    { $group: { _id: '$customerCode', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'groups' },
  ]).toArray()[0] || { groups: 0 };
  snap.customers = {
    total: c.countDocuments({}),
    softDeleted: c.countDocuments({ deletedAt: { $ne: null } }),
    withCode: c.countDocuments({ customerCode: { $type: 'string' } }),
    withoutCode: c.countDocuments({ customerCode: { $not: { $type: 'string' } } }),
    duplicateCodeGroups: dupCode.groups,
    phoneNull: c.countDocuments({ phone: null }), // gồm cả thiếu trường
    phoneAnonymized: c.countDocuments({ phone: /^anonymized:/ }),
    duplicatePhoneGroups: dupPhone.groups,
    duplicatePhoneCustomers: dupPhone.customers,
    // Bất biến FR-10: careTeam không rỗng thì phải có primaryAssigneeId (phải = 0).
    careTeamWithoutPrimary: c.countDocuments({ 'careTeam.0': { $exists: true }, primaryAssigneeId: null }),
  };
  snap.customerIndexes = c.getIndexes()
    .map((i) => sortObj({ name: i.name, key: i.key, unique: i.unique === true, partialFilterExpression: i.partialFilterExpression || null }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

if (has('counters')) snap.counters = d.counters.find({}).sort({ _id: 1 }).toArray().map((x) => sortObj(x));

// Doc `system`: chỉ _id + trường vô hướng (chuỗi/số/bool/ngày). Bỏ trường error/message (có thể chứa nội dung lỗi tự do).
if (has('system')) {
  snap.system = d.system.find({}).sort({ _id: 1 }).toArray().map((x) => {
    const o = {};
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (/error|message|stack/i.test(k)) { o[k] = '<ẩn>'; continue; }
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
      else if (v instanceof Date) o[k] = v.toISOString();
      else o[k] = '<' + (Array.isArray(v) ? 'array' : 'object') + '>';
    }
    return sortObj(o);
  });
}

print(JSON.stringify(snap, null, 2));
