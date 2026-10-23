import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor } from '../../common/access/crm-actor';

declare const customerScopeBrand: unique symbol;

/**
 * Phạm vi khách (row-level) của một người dùng — kiểu "branded": chỉ `buildCustomerScope` tạo được
 * (symbol không export), nên repository bắt buộc nhận `CustomerScope` thì thiếu phạm vi là lỗi biên dịch
 * (tài liệu 04 mục 4.3).
 */
export type CustomerScope = Readonly<Record<string, unknown>> & {
  readonly [customerScopeBrand]: true;
};

const brand = (filter: Record<string, unknown>): CustomerScope =>
  filter as unknown as CustomerScope;

/**
 * Dựng phạm vi theo vai trò HIỆN TẠI trong DB:
 * - ADMIN: tất cả (`{}`);
 * - MANAGER: khách có `teamIds` giao với nhóm mình quản lý, HOẶC mình nằm trong `careTeam`;
 * - STAFF: chỉ khách có mình trong `careTeam` (PRIMARY hoặc MEMBER);
 * - vai trò khác (EDITOR...): không thấy khách nào.
 */
export const buildCustomerScope = (actor: CrmActor): CustomerScope => {
  switch (actor.role) {
    case UserRole.ADMIN:
      return brand({});
    case UserRole.MANAGER:
      return brand({
        $or: [
          { teamIds: { $in: actor.managedTeamIds } },
          { 'careTeam.userId': actor.userId },
        ],
      });
    case UserRole.STAFF:
      return brand({ 'careTeam.userId': actor.userId });
    default:
      return brand({ _id: { $in: [] as Types.ObjectId[] } });
  }
};

/** Quản trị hoặc Quản lý (trong phạm vi) — nhóm quyền "A, M-P" của ma trận 04 mục 4.2. */
export const isAdminOrManager = (actor: CrmActor): boolean =>
  actor.role === UserRole.ADMIN || actor.role === UserRole.MANAGER;
