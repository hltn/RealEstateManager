import type { Db } from 'mongodb';

export interface BackfillUserTeamIdResult {
  /** Số tài khoản chưa có field `teamId` trước khi chạy. */
  missingBefore: number;
  /** Số tài khoản được ghi `teamId: null` (0 khi dry-run). */
  updated: number;
  /** Số tài khoản theo vai trò — để đối chiếu dữ liệu cũ (ADMIN/EDITOR) không bị đổi. */
  roleCounts: Record<string, number>;
}

const USERS_COLLECTION = 'users';
const TEAM_INDEX_KEY = { teamId: 1, status: 1 } as const;

/**
 * Migration CRM M1 — thêm `users.teamId = null` cho tài khoản cũ và tạo index `{ teamId, status }`.
 *
 * Tương thích ngược (tài liệu 04 mục 3.8): chỉ THÊM field, không đổi/xóa `role`, `status` hay field nào khác;
 * tài khoản ADMIN/EDITOR giữ nguyên. Enum `MANAGER`/`STAFF` không cần dữ liệu — chỉ là giá trị mới được phép.
 *
 * IDEMPOTENT: chỉ chạm tài khoản CHƯA có field `teamId`; chạy lại là no-op. `apply=false` (dry-run) không ghi gì.
 */
export async function backfillUserTeamId(
  db: Db,
  apply: boolean,
): Promise<BackfillUserTeamIdResult> {
  const users = db.collection(USERS_COLLECTION);

  const roleRows = await users
    .aggregate<{
      _id: string;
      count: number;
    }>([{ $group: { _id: '$role', count: { $sum: 1 } } }])
    .toArray();
  const roleCounts = Object.fromEntries(
    roleRows.map((row) => [String(row._id), row.count]),
  );

  const missingBefore = await users.countDocuments({
    teamId: { $exists: false },
  });
  if (!apply) return { missingBefore, updated: 0, roleCounts };

  const result = await users.updateMany(
    { teamId: { $exists: false } },
    { $set: { teamId: null } },
  );
  await users.createIndex(TEAM_INDEX_KEY);
  return { missingBefore, updated: result.modifiedCount, roleCounts };
}
