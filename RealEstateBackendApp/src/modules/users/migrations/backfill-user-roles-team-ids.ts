import type { Db } from 'mongodb';
import { ROLE_PRECEDENCE } from '../../../common/utils/user-roles.util';

export interface BackfillUserRolesTeamIdsResult {
  /** Số tài khoản cần bổ sung `roles`/`teamIds` trước khi chạy. */
  pendingBefore: number;
  /** Số tài khoản được cập nhật (0 khi dry-run). */
  updated: number;
  /** Số tài khoản theo vai trò chính — để đối chiếu dữ liệu cũ không bị đổi. */
  roleCounts: Record<string, number>;
  /**
   * Số tài khoản ĐÃ có `roles`/`teamIds` nhưng LỆCH cặp suy ra (`role` ≠ role cao nhất của `roles`, hoặc `teamId` ≠
   * `teamIds[0]`) — thường do pod/phiên bản code cũ ghi `role`/`teamId` đơn lúc rolling deploy. Tính trước khi ghi.
   */
  driftBefore: number;
  /** Tối đa 20 `_id` đầu tiên bị lệch (để điều tra). */
  driftIds: string[];
  /**
   * Tối đa 20 `_id` bị lệch có `teamId = null` nhưng `teamIds` còn giá trị: `reconcile` sẽ XÓA `teamIds` của họ
   * (nguồn đúng là `teamId` đơn).
   */
  driftClearsTeamIds: string[];
  /**
   * Số tài khoản được ghi lại theo `role`/`teamId` đơn (0 khi dry-run hoặc không có `reconcile`). `driftBefore` đếm
   * TRƯỚC backfill nên bản ghi vừa chưa migrate vừa lệch (lệch lộ ra sau backfill) có thể làm `reconciled` > `driftBefore`.
   */
  reconciled: number;
}

export interface BackfillUserRolesTeamIdsOptions {
  /**
   * Khi `apply` + `reconcile`: với tài khoản bị lệch, lấy cặp ĐƠN `role`/`teamId` làm nguồn đúng và đặt lại
   * `roles = [role]`, `teamIds = teamId ? [teamId] : []`. THU GỌN người nhiều role/nhiều nhóm bị lệch.
   */
  reconcile?: boolean;
}

const USERS_COLLECTION = 'users';
const DRIFT_SAMPLE_SIZE = 20;
/** Index mới (multikey); giữ index cũ `{ teamId, status }` vì truy vấn cũ/`teamId` suy ra vẫn dùng. */
const TEAM_IDS_INDEX_KEY = { teamIds: 1, status: 1 } as const;
const ROLES_INDEX_KEY = { roles: 1, status: 1 } as const;

/**
 * Tài khoản chưa có `roles` (thiếu/rỗng) hoặc chưa có field `teamIds`.
 * Dùng chung với guard khởi động (`UserRolesMigrationGuard`) để hai nơi cùng một định nghĩa "chưa migrate".
 */
export const USERS_PENDING_ROLES_TEAM_IDS_FILTER = {
  $or: [
    { roles: { $exists: false } },
    { roles: { $size: 0 } },
    { teamIds: { $exists: false } },
  ],
};

const hasItems = (field: string) => ({
  $gt: [{ $size: { $ifNull: [field, []] } }, 0],
});

/** Biểu thức aggregation: role cao nhất trong `$roles` theo `ROLE_PRECEDENCE` (ADMIN > MANAGER > STAFF > EDITOR). */
const highestRoleExpression = ROLE_PRECEDENCE.reduceRight<unknown>(
  (otherwise, role) => ({
    $cond: [{ $in: [role, '$roles'] }, role, otherwise],
  }),
  null,
);

/**
 * Tài khoản đã migrate (roles không rỗng, có teamIds) nhưng cặp suy ra lệch nguồn:
 * `role` ≠ role cao nhất của `roles`, hoặc `teamId` ≠ `teamIds[0]` (so với null khi rỗng).
 * Chỉ xét khi có đủ field `role`/`teamId` để không "thu gọn" nhầm bản ghi thiếu field.
 */
const DRIFT_FILTER = {
  roles: { $exists: true, $not: { $size: 0 } },
  teamIds: { $exists: true },
  // role hợp lệ: `role: null`/giá trị lạ không bị coi là nguồn đúng (tránh ghi roles:[null]).
  role: { $in: [...ROLE_PRECEDENCE] },
  teamId: { $exists: true },
  $expr: {
    $or: [
      { $ne: ['$role', highestRoleExpression] },
      {
        $ne: [
          { $ifNull: ['$teamId', null] },
          { $ifNull: [{ $arrayElemAt: ['$teamIds', 0] }, null] },
        ],
      },
    ],
  },
};

/**
 * Migration CRM — thêm `users.roles` và `users.teamIds` từ `role`/`teamId` đơn (một tài khoản nhiều role, nhiều nhóm).
 *
 * Tương thích ngược: chỉ THÊM field; `role` và `teamId` KHÔNG đổi (chúng vẫn là trường suy ra: role cao nhất / nhóm chính).
 * - `roles` = [role] (role thiếu coi như EDITOR — mặc định của schema); đã có `roles` không rỗng thì giữ nguyên.
 * - `teamIds` = [teamId] nếu có teamId, ngược lại []; đã có `teamIds` không rỗng thì giữ nguyên.
 *
 * IDEMPOTENT: chỉ chạm tài khoản đang thiếu; chạy lại là no-op. `apply=false` (dry-run) không ghi gì (kể cả index).
 * Dùng pipeline update (một lệnh, không đọc-rồi-ghi) và driver thô nên KHÔNG đổi `updatedAt`.
 *
 * LỆCH cặp suy ra: luôn được ĐẾM và báo (`driftBefore`), nhưng chỉ được GHI LẠI khi `apply` + `reconcile`
 * (nguồn đúng là cặp đơn `role`/`teamId`; xem `BackfillUserRolesTeamIdsOptions.reconcile`).
 *
 * Phải chạy TRƯỚC/CÙNG lúc triển khai code mới: truy vấn mới lọc theo `roles`/`teamIds`.
 */
export async function backfillUserRolesTeamIds(
  db: Db,
  apply: boolean,
  options: BackfillUserRolesTeamIdsOptions = {},
): Promise<BackfillUserRolesTeamIdsResult> {
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

  const pendingBefore = await users.countDocuments(
    USERS_PENDING_ROLES_TEAM_IDS_FILTER,
  );
  const drifted = await users
    .find(DRIFT_FILTER, { projection: { _id: 1, teamId: 1, teamIds: 1 } })
    .toArray();
  const driftBefore = drifted.length;
  const driftIds = drifted
    .slice(0, DRIFT_SAMPLE_SIZE)
    .map((user) => String(user._id));
  const driftClearsTeamIds = drifted
    .filter(
      (user) =>
        (user.teamId ?? null) === null &&
        Array.isArray(user.teamIds) &&
        user.teamIds.length > 0,
    )
    .slice(0, DRIFT_SAMPLE_SIZE)
    .map((user) => String(user._id));
  if (!apply) {
    return {
      pendingBefore,
      updated: 0,
      roleCounts,
      driftBefore,
      driftIds,
      driftClearsTeamIds,
      reconciled: 0,
    };
  }

  const result = await users.updateMany(USERS_PENDING_ROLES_TEAM_IDS_FILTER, [
    {
      $set: {
        roles: {
          $cond: [
            hasItems('$roles'),
            '$roles',
            [{ $ifNull: ['$role', 'EDITOR'] }],
          ],
        },
        teamIds: {
          $cond: [
            hasItems('$teamIds'),
            '$teamIds',
            {
              $cond: [
                { $ne: [{ $ifNull: ['$teamId', null] }, null] },
                ['$teamId'],
                [],
              ],
            },
          ],
        },
      },
    },
  ]);

  let reconciled = 0;
  if (options.reconcile) {
    const fixed = await users.updateMany(DRIFT_FILTER, [
      {
        $set: {
          roles: ['$role'],
          teamIds: {
            $cond: [
              { $ne: [{ $ifNull: ['$teamId', null] }, null] },
              ['$teamId'],
              [],
            ],
          },
        },
      },
    ]);
    reconciled = fixed.modifiedCount;
  }

  await users.createIndex(TEAM_IDS_INDEX_KEY);
  await users.createIndex(ROLES_INDEX_KEY);
  return {
    pendingBefore,
    updated: result.modifiedCount,
    roleCounts,
    driftBefore,
    driftIds,
    driftClearsTeamIds,
    reconciled,
  };
}
