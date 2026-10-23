/**
 * Migration 004 — CRM M1: thêm `users.teamId = null` cho tài khoản cũ + index { teamId, status }.
 *
 * Bối cảnh: module CRM thêm vai trò MANAGER/STAFF và field `users.teamId` (tài liệu 04 mục 3.8).
 * Tài khoản cũ (ADMIN/EDITOR) KHÔNG đổi role/status; chỉ được bổ sung `teamId: null`.
 *
 * Backward Compatible: CÓ — chỉ thêm field + index. Code vẫn chạy đúng khi chưa migrate vì field thiếu
 * được hiểu là `null`; migration chỉ làm dữ liệu đồng nhất để index/lọc theo `teamId: null` hiệu quả.
 *
 * Idempotent: chỉ cập nhật tài khoản chưa có field `teamId`; createIndex không đổi nếu index đã có.
 *
 * Chạy:
 *   Dry-run (mặc định, không ghi):  npx ts-node scripts/migrations/004_users_add_team_id.ts
 *   Thực thi thật:                  npx ts-node scripts/migrations/004_users_add_team_id.ts --apply
 *
 * Author: Neptune — 2026-10-23
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { backfillUserTeamId } from '../../src/modules/users/migrations/backfill-user-team-id';

dotenv.config();

function log(msg: string): void {
  console.log(`[004] ${msg}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    log('ERROR: MONGODB_URI (hoặc MONGO_URI) chưa được set trong .env');
    process.exit(1);
  }

  log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const result = await backfillUserTeamId(client.db(), apply);
    log(`Tài khoản theo vai trò: ${JSON.stringify(result.roleCounts)}`);
    log(`Chưa có teamId: ${result.missingBefore}`);
    log(
      apply
        ? `Đã cập nhật: ${result.updated}`
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
