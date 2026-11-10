import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmActor } from '../common/access/crm-actor';
import { isAdminOrManager } from '../customers/access/customer-scope';
import { CareRole } from '../customers/customer.constants';
import { CareTeamEntry } from '../customers/schemas/customer.schema';

/** Độ dài tối đa của phần `requestId` trong `pushGroupKey` (header `X-Request-ID` do client gửi, không tin độ dài). */
export const MAX_PUSH_GROUP_REQUEST_ID_LENGTH = 128;

/**
 * Khóa đợt hàng loạt `BULK:{requestId}` để worker giới hạn 3 push/người/đợt (T-33). `requestId` bị cắt còn
 * `MAX_PUSH_GROUP_REQUEST_ID_LENGTH` ký tự; thiếu/rỗng (ngoài ngữ cảnh HTTP) thì trả `undefined` (không giới hạn).
 */
export const buildBulkPushGroupKey = (
  requestId: string | undefined,
): string | undefined =>
  requestId
    ? `BULK:${requestId.slice(0, MAX_PUSH_GROUP_REQUEST_ID_LENGTH)}`
    : undefined;

/** Kết quả một thay đổi nhóm chăm sóc: nhóm mới + người mới vào/ra + phụ trách chính có đổi không. */
export interface CareTeamChange {
  careTeam: CareTeamEntry[];
  addedUserIds: Types.ObjectId[];
  removedUserIds: Types.ObjectId[];
  primaryChanged: boolean;
}

export interface AddMembersInput {
  userIds: Types.ObjectId[];
  primaryUserId?: Types.ObjectId;
}

export interface AddMembersOptions {
  /** Người đã có trong nhóm thì bỏ qua thay vì báo lỗi (thao tác hàng loạt). */
  skipExisting?: boolean;
}

const uniqueIds = (ids: Types.ObjectId[]): Types.ObjectId[] => [
  ...new Map(ids.map((id) => [String(id), id])).values(),
];

const hasUser = (careTeam: CareTeamEntry[], userId: Types.ObjectId): boolean =>
  careTeam.some((member) => member.userId.equals(userId));

export const findPrimary = (
  careTeam: CareTeamEntry[],
): CareTeamEntry | undefined =>
  careTeam.find((member) => member.role === CareRole.PRIMARY);

/**
 * Bất biến của nhóm chăm sóc (tài liệu 04 mục 3.2): rỗng, hoặc ĐÚNG 1 PRIMARY và `userId` không trùng.
 * Gọi trước mọi lần ghi — vi phạm là lỗi lập trình (500), không bao giờ để dữ liệu sai xuống DB.
 */
export const assertCareTeamInvariant = (careTeam: CareTeamEntry[]): void => {
  if (careTeam.length === 0) return;
  const primaries = careTeam.filter(
    (member) => member.role === CareRole.PRIMARY,
  );
  const distinct = new Set(careTeam.map((member) => String(member.userId)));
  if (primaries.length !== 1 || distinct.size !== careTeam.length) {
    throw new Error(
      'Nhóm chăm sóc vi phạm bất biến: đúng 1 PRIMARY, không trùng người',
    );
  }
};

/** Chỉ Quản trị, Quản lý (trong phạm vi) hoặc phụ trách chính được thêm/gỡ thành viên (ma trận 4.2). */
export const canManageMembers = (
  actor: CrmActor,
  careTeam: CareTeamEntry[],
): boolean =>
  actor.role === UserRole.ADMIN ||
  actor.role === UserRole.MANAGER ||
  careTeam.some(
    (member) =>
      member.role === CareRole.PRIMARY && member.userId.equals(actor.userId),
  );

/**
 * Đặt phụ trách chính LẦN ĐẦU (FR-11): chỉ Quản trị/Quản lý và chỉ khi nhóm đang rỗng (khách cũ chưa có PRIMARY).
 * Đã có PRIMARY thì khóa vĩnh viễn nên không còn quyền nào đổi/gỡ.
 */
export const canSetInitialPrimary = (
  actor: CrmActor,
  careTeam: CareTeamEntry[],
): boolean => careTeam.length === 0 && isAdminOrManager(actor);

export const careTeamActionForbidden = (message: string): BusinessException =>
  new BusinessException(
    ErrorCode.CARE_TEAM_ACTION_FORBIDDEN,
    message,
    HttpStatus.FORBIDDEN,
  );

const validationFailed = (message: string): BusinessException =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
  );

const entry = (
  userId: Types.ObjectId,
  role: CareRole,
  actorId: Types.ObjectId,
  now: Date,
): CareTeamEntry => ({ userId, role, addedBy: actorId, addedAt: now });

/**
 * Thêm thành viên. Nhóm đang rỗng (lần phân đầu): bắt buộc `primaryUserId` (400 `PRIMARY_REQUIRED`), người đó
 * tự được thêm. Nhóm đã có người: người mới chỉ là MEMBER; `primaryUserId` bị từ chối (400 `VALIDATION_FAILED`)
 * vì PRIMARY đã khóa (FR-11). Quyền đặt PRIMARY lần đầu (`canSetInitialPrimary`) do tầng service kiểm.
 */
export const planAddMembers = (
  current: CareTeamEntry[],
  input: AddMembersInput,
  actorId: Types.ObjectId,
  now: Date,
  options: AddMembersOptions = {},
): CareTeamChange => {
  const requested = uniqueIds(input.userIds);
  const duplicated = requested.filter((id) => hasUser(current, id));
  if (duplicated.length > 0 && !options.skipExisting) {
    throw new BusinessException(
      ErrorCode.ALREADY_IN_CARE_TEAM,
      'Có người đã nằm trong nhóm chăm sóc của khách này',
      HttpStatus.CONFLICT,
      { userIds: duplicated.map(String) },
    );
  }
  const toAdd = requested.filter((id) => !hasUser(current, id));
  const { primaryUserId } = input;

  if (current.length === 0) {
    if (!primaryUserId) {
      throw new BusinessException(
        ErrorCode.PRIMARY_REQUIRED,
        'Lần phân chăm sóc đầu tiên phải chọn người phụ trách chính',
        HttpStatus.BAD_REQUEST,
      );
    }
    const ids = uniqueIds([...toAdd, primaryUserId]);
    const careTeam = ids.map((id) =>
      entry(
        id,
        id.equals(primaryUserId) ? CareRole.PRIMARY : CareRole.MEMBER,
        actorId,
        now,
      ),
    );
    assertCareTeamInvariant(careTeam);
    return {
      careTeam,
      addedUserIds: ids,
      removedUserIds: [],
      primaryChanged: true,
    };
  }

  if (primaryUserId) {
    throw validationFailed(
      'Nhóm đã có phụ trách chính, không thể đặt hoặc đổi phụ trách chính',
    );
  }
  const careTeam = [
    ...current,
    ...toAdd.map((id) => entry(id, CareRole.MEMBER, actorId, now)),
  ];
  assertCareTeamInvariant(careTeam);
  return {
    careTeam,
    addedUserIds: toAdd,
    removedUserIds: [],
    primaryChanged: false,
  };
};

/**
 * Gỡ thành viên. PRIMARY bị khóa: gỡ PRIMARY (kể cả Quản trị/Quản lý, kể cả qua thao tác hàng loạt) luôn là
 * 409 `PRIMARY_LOCKED` (FR-11). Gỡ người không có trong nhóm: 404.
 */
export const planRemoveMember = (
  current: CareTeamEntry[],
  userId: Types.ObjectId,
): CareTeamChange => {
  const target = current.find((member) => member.userId.equals(userId));
  if (!target) {
    throw new BusinessException(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Người này không có trong nhóm chăm sóc',
      HttpStatus.NOT_FOUND,
    );
  }
  if (target.role === CareRole.PRIMARY) {
    throw new BusinessException(
      ErrorCode.PRIMARY_LOCKED,
      'Người phụ trách chính đã bị khóa, không thể gỡ',
      HttpStatus.CONFLICT,
    );
  }
  const remaining = current.filter((member) => !member.userId.equals(userId));
  assertCareTeamInvariant(remaining);
  return {
    careTeam: remaining,
    addedUserIds: [],
    removedUserIds: [userId],
    primaryChanged: false,
  };
};
