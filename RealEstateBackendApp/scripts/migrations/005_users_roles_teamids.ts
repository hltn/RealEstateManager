/**
 * Migration 005 — CRM: thêm `users.roles[]` + `users.teamIds[]` (một tài khoản nhiều role, nhiều nhóm) và index
 * { teamIds, status } (multikey) + { roles, status }.
 *
 * Bối cảnh: trước đây mỗi tài khoản chỉ có `role` và `teamId` đơn. Nay `roles`/`teamIds` là nguồn dữ liệu chính;
 * `role` (role cao nhất ADMIN > MANAGER > STAFF > EDITOR) và `teamId` (= teamIds[0]) được giữ làm trường SUY RA.
 *
 * Backward Compatible: CÓ — chỉ thêm field + index, `role`/`teamId` không đổi; index cũ { teamId, status } giữ nguyên.
 * Idempotent: chỉ cập nhật tài khoản chưa migrate = `roles` thiếu/null/sai kiểu (không phải mảng) hoặc rỗng, hoặc `teamIds`
 * thiếu/null/sai kiểu; createIndex không đổi nếu đã có.
 *
 * THỨ TỰ TRIỂN KHAI BẮT BUỘC (code mới lọc theo `roles`/`teamIds`; production sẽ KHÔNG khởi động nếu còn tài khoản
 * chưa migrate — xem `UserRolesMigrationGuard`):
 *   1. mongodump (sao lưu DB trước khi ghi).
 *   2. 005 --dry-run  (mặc định, chỉ đếm: số tài khoản cần bổ sung + số tài khoản LỆCH cặp suy ra).
 *   3. 005 --apply    (ghi thật).
 *   4. Rồi MỚI chạy/triển khai code mới.
 *   Nếu rolling deploy để pod cũ còn ghi `role`/`teamId` đơn sau bước 3, tài khoản đó sẽ LỆCH: chạy lại bước 2 để thấy
 *   số lệch, rồi `--apply --reconcile` khi mọi pod cũ đã tắt.
 *
 * LỆCH cặp suy ra = đã có roles/teamIds nhưng `role` ≠ role cao nhất của `roles`, hoặc `teamId` ≠ `teamIds[0]`.
 * `--reconcile` (chỉ có tác dụng cùng `--apply`) coi cặp ĐƠN `role`/`teamId` là nguồn đúng (vì lệch sinh ra khi pod cũ ghi
 * role/teamId đơn) và đặt `roles=[role]`, `teamIds = teamId ? [teamId] : []`. CẢNH BÁO: việc này THU GỌN người nhiều
 * role/nhiều nhóm đang bị lệch về đúng một role/nhóm; `customers.teamIds` KHÔNG tự tính lại (cần kiểm tra/đồng bộ riêng).
 *
 * Chạy:
 *   Dry-run (mặc định, không ghi):  npx ts-node scripts/migrations/005_users_roles_teamids.ts
 *   Thực thi thật:                  npx ts-node scripts/migrations/005_users_roles_teamids.ts --apply
 *   Thực thi + xử lý lệch:          npx ts-node scripts/migrations/005_users_roles_teamids.ts --apply --reconcile
 *   (--reconcile mà không có --apply: vẫn là dry-run, không ghi gì.)
 *
 * Author: Neptune — 2026-10-29
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { backfillUserRolesTeamIds } from '../../src/modules/users/migrations/backfill-user-roles-team-ids';

dotenv.config();

function log(msg: string): void {
  console.log(`[005] ${msg}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const reconcile = process.argv.includes('--reconcile');
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    log('ERROR: MONGODB_URI (hoặc MONGO_URI) chưa được set trong .env');
    process.exit(1);
  }

  log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}${reconcile ? ' + RECONCILE' : ''}`);
  if (reconcile && !apply) {
    log('Lưu ý: --reconcile cần đi kèm --apply; lần chạy này chỉ là DRY-RUN.');
  }
  if (reconcile && apply) {
    log(
      'CẢNH BÁO: --reconcile sẽ đặt roles=[role], teamIds=[teamId] cho tài khoản bị lệch, THU GỌN người nhiều role/nhóm bị lệch.',
    );
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const result = await backfillUserRolesTeamIds(client.db(), apply, {
      reconcile,
    });
    log(`Tài khoản theo vai trò: ${JSON.stringify(result.roleCounts)}`);
    log(`Cần bổ sung roles/teamIds: ${result.pendingBefore}`);
    log(
      `Lệch cặp suy ra (role ≠ role cao nhất của roles, hoặc teamId ≠ teamIds[0]): ${result.driftBefore}` +
        (result.driftIds.length > 0
          ? ` — _id (tối đa ${result.driftIds.length}): ${result.driftIds.join(', ')}`
          : ''),
    );
    if (result.driftBefore > 0 && reconcile) {
      log(
        'CẢNH BÁO --reconcile: sẽ THU GỌN các tài khoản lệch về roles=[role], teamIds=[teamId] (mất các role/nhóm thêm).',
      );
      if (result.driftClearsTeamIds.length > 0) {
        log(
          `CẢNH BÁO --reconcile: sẽ XÓA teamIds của các _id có teamId=null nhưng teamIds còn giá trị: ${result.driftClearsTeamIds.join(', ')}`,
        );
      }
      log(
        'Lưu ý: số lệch đếm TRƯỚC backfill; bản ghi vừa chưa migrate vừa lệch có thể làm số "đã reconcile" lớn hơn số lệch.',
      );
    }
    if (result.driftBefore > 0 && !(apply && reconcile)) {
      log(
        'Có tài khoản LỆCH: thêm --apply --reconcile (sau khi mọi pod cũ đã tắt) để ghi lại theo role/teamId đơn.',
      );
    }
    log(
      apply
        ? `Đã cập nhật: ${result.updated}${reconcile ? `; đã reconcile: ${result.reconciled}` : ''}`
        : 'DRY-RUN: không ghi gì. Thêm --apply để thực thi.',
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  log(`FAILED: ${(error as Error).message}`);
  process.exit(1);
});
