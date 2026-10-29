/**
 * Migration 006 — CRM: đổi khu vực sang đúng 34 tỉnh/thành (hiệu lực 01/07/2025, Nghị quyết 202/2025/QH15).
 *
 * Quyết định nghiệp vụ: dữ liệu khu vực CŨ bị bỏ hẳn (không giữ, không chuyển đổi). Khách/dự án đang trỏ khu vực
 * không thuộc 34 tỉnh => `areaId = null`; các bản ghi `areas` cũ bị xóa; 34 tỉnh được upsert theo `seedKey`.
 * Chi tiết thuật toán + lý do xóa cứng: xem `migrateAreasTo34Provinces`.
 *
 * Backward Compatible: field `areaId` vẫn tồn tại (chỉ đổi giá trị về null — field này vốn nullable); API/schema không đổi.
 * Idempotent: chạy lại không đổi gì. Không đổi `updatedAt`/`version` khách, không ghi audit từng khách, không gửi nhắc nhở.
 * Yêu cầu MongoDB Replica Set (chạy trong 1 transaction).
 *
 * Chạy (luôn dry-run trước, kiểm tra số liệu rồi mới --apply):
 *   Dry-run (mặc định, không ghi):  npx ts-node scripts/migrations/006_areas_34_provinces.ts --dry-run
 *   Thực thi thật:                  npx ts-node scripts/migrations/006_areas_34_provinces.ts --apply
 * Nên backup DB (mongodump) trước khi --apply vì bước xóa khu vực cũ không hoàn tác được.
 *
 * Author: Neptune — 2026-10-29
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { migrateAreasTo34Provinces } from '../../src/modules/crm/catalogs/migrations/migrate-areas-to-34-provinces';

dotenv.config();

function log(msg: string): void {
  console.log(`[006] ${msg}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (apply && process.argv.includes('--dry-run')) {
    log('ERROR: --apply và --dry-run không dùng cùng nhau');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    log('ERROR: MONGODB_URI (hoặc MONGO_URI) chưa được set trong .env');
    process.exit(1);
  }

  log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const result = await migrateAreasTo34Provinces(client.db(), apply);
    const verb = apply ? 'Đã' : 'Sẽ';
    log(
      `${verb} bỏ khu vực của khách (areaId = null): ${result.customersCleared}`,
    );
    log(
      `${verb} bỏ khu vực của dự án (areaId = null): ${result.projectsCleared}`,
    );
    log(`${verb} xóa khu vực cũ: ${result.areasDeleted}`);
    log(`Tỉnh/thành có sẵn, giữ nguyên id: ${result.provincesKept}`);
    log(`${verb} tạo mới tỉnh/thành: ${result.provincesInserted}`);
    log(
      `${verb} chuẩn hóa order/type/seedKey của tỉnh giữ lại: ${result.provincesNormalized}`,
    );
    if (!apply) log('DRY-RUN: không ghi gì. Thêm --apply để thực thi.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  log(`FAILED: ${(error as Error).message}`);
  process.exit(1);
});
