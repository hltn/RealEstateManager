// Bước 3 của diễn tập (Architecture 5.10, FR-21): giả lập khoảng giữa 6b và `up`, khi image CŨ v1.0.3 còn phục vụ. CHỈ chạy trên staging:
//   docker exec -i rhstg_mongo mongosh --quiet --norc --file /dev/stdin < scripts/staging/rehearsal-step3.js   (hoặc: staging.sh step3)
// Sau migration 010 (pre-up) và TRƯỚC 011: (a) chèn khách KHÔNG có `customerCode` phải THÀNH CÔNG (unique mã là partial); (b) chèn khách thứ hai
// trùng SĐT với một khách có sẵn phải LỖI E11000 (unique phone_1 còn, tức 011 chưa chạy). Doc chèn mang `rehearsalMarker: 'T-18'` để nhận ra và
// dọn sau diễn tập. Chỉ đụng DB `realestate` của container nơi script chạy. In MỘT dòng JSON kết quả; thoát mã 1 (quit(1)) nếu kết quả sai.
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const c = db.getSiblingDB('realestate').customers;
const MARK = 'T-18';
const stamp = Date.now();
const res = { insertedWithoutCode: 0, insertWithoutCodeError: null, duplicatePhoneRejected: null, duplicatePhoneError: null, ok: false };
const base = { rehearsalMarker: MARK, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), careTeam: [] };
for (let i = 1; i <= 2; i++) {
  try { c.insertOne(Object.assign({ fullName: 'Diễn tập ' + i, phone: 'REH-' + stamp + '-' + i }, base)); res.insertedWithoutCode++; }
  catch (e) { res.insertWithoutCodeError = String(e.code || '') + ' ' + String(e.message).slice(0, 120); }
}
// Trùng SĐT với một khách thật có sẵn (chuỗi, không phải ẩn danh/rehearsal). Đọc SĐT chỉ để so, KHÔNG in ra.
const donor = c.findOne({ phone: { $type: 'string', $not: /^(anonymized:|REH-)/ }, rehearsalMarker: { $exists: false } }, { phone: 1 });
if (!donor) { res.duplicatePhoneError = 'không có khách mẫu có SĐT để thử trùng'; }
else {
  try {
    c.insertOne(Object.assign({ fullName: 'Diễn tập trùng', phone: donor.phone }, base));
    res.duplicatePhoneRejected = false; // chèn được = unique đã gỡ (011 đã chạy?) hoặc index sai
  } catch (e) {
    res.duplicatePhoneRejected = e.code === 11000;
    res.duplicatePhoneError = 'code=' + e.code;
  }
}
res.ok = res.insertedWithoutCode === 2 && res.duplicatePhoneRejected === true;
// Nếu chèn trùng bất ngờ thành công, gỡ ngay doc có marker đó để không để lại bản trùng.
if (res.duplicatePhoneRejected === false) c.deleteMany({ rehearsalMarker: MARK, fullName: 'Diễn tập trùng' });
print(JSON.stringify(res));
if (!res.ok) quit(1);
