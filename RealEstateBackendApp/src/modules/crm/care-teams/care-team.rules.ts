import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmActor } from '../common/access/crm-actor';
import { CareRole } from '../customers/customer.constants';
import { CareTeamEntry } from '../customers/schemas/customer.schema';

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
  /** Cho phép đổi phụ trách chính khi nhóm đã có người (thao tác hàng loạt của Quản trị/Quản lý). */
  allowPrimaryChange?: boolean;
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

/** Chỉ Quản trị và Quản lý (trong phạm vi) được đổi/gỡ phụ trách chính. */
export const canChangePrimary = (actor: CrmActor): boolean =>
  actor.role === UserRole.ADMIN || actor.role === UserRole.MANAGER;

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
 * Đổi phụ trách chính: người mới tự được thêm nếu chưa có, người cũ thành MEMBER.
 * Đã là phụ trách chính thì không đổi gì.
 */
export const planChangePrimary = (
  current: CareTeamEntry[],
  userId: Types.ObjectId,
  actorId: Types.ObjectId,
  now: Date,
): CareTeamChange => {
  if (findPrimary(current)?.userId.equals(userId)) {
    return {
      careTeam: current,
      addedUserIds: [],
      removedUserIds: [],
      primaryChanged: false,
    };
  }
  const isMember = hasUser(current, userId);
  const demoted = current.map((member) =>
    member.role === CareRole.PRIMARY
      ? { ...member, role: CareRole.MEMBER }
      : member,
  );
  const careTeam = isMember
    ? demoted.map((member) =>
        member.userId.equals(userId)
          ? { ...member, role: CareRole.PRIMARY }
          : member,
      )
    : [...demoted, entry(userId, CareRole.PRIMARY, actorId, now)];
  assertCareTeamInvariant(careTeam);
  return {
    careTeam,
    addedUserIds: isMember ? [] : [userId],
    removedUserIds: [],
    primaryChanged: true,
  };
};

/**
 * Thêm thành viên. Nhóm đang rỗng (lần phân đầu): bắt buộc `primaryUserId` (400 `PRIMARY_REQUIRED`), người đó
 * tự được thêm. Nhóm đã có người: người mới là MEMBER; `primaryUserId` bị từ chối (dùng PUT primary) trừ khi
 * `allowPrimaryChange`.
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

  if (primaryUserId && !options.allowPrimaryChange) {
    throw validationFailed(
      'Nhóm đã có phụ trách chính, hãy dùng thao tác đổi phụ trách chính',
    );
  }
  const withMembers = [
    ...current,
    ...toAdd.map((id) => entry(id, CareRole.MEMBER, actorId, now)),
  ];
  if (!primaryUserId) {
    assertCareTeamInvariant(withMembers);
    return {
      careTeam: withMembers,
      addedUserIds: toAdd,
      removedUserIds: [],
      primaryChanged: false,
    };
  }
  const changed = planChangePrimary(withMembers, primaryUserId, actorId, now);
  return {
    ...changed,
    addedUserIds: uniqueIds([...toAdd, ...changed.addedUserIds]),
  };
};

/**
 * Gỡ thành viên. Gỡ PRIMARY bắt buộc chỉ định người thay (400 `PRIMARY_REPLACEMENT_REQUIRED`); người thay
 * chưa có trong nhóm thì được thêm làm PRIMARY. Gỡ người không có trong nhóm: 404.
 */
export const planRemoveMember = (
  current: CareTeamEntry[],
  userId: Types.ObjectId,
  newPrimaryUserId: Types.ObjectId | undefined,
  actorId: Types.ObjectId,
  now: Date,
): CareTeamChange => {
  const target = current.find((member) => member.userId.equals(userId));
  if (!target) {
    throw new BusinessException(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Người này không có trong nhóm chăm sóc',
      HttpStatus.NOT_FOUND,
    );
  }
  const remaining = current.filter((member) => !member.userId.equals(userId));

  if (target.role !== CareRole.PRIMARY) {
    if (newPrimaryUserId) {
      throw validationFailed(
        'Chỉ truyền người thay thế khi gỡ phụ trách chính',
      );
    }
    assertCareTeamInvariant(remaining);
    return {
      careTeam: remaining,
      addedUserIds: [],
      removedUserIds: [userId],
      primaryChanged: false,
    };
  }

  if (!newPrimaryUserId) {
    throw new BusinessException(
      ErrorCode.PRIMARY_REPLACEMENT_REQUIRED,
      'Gỡ phụ trách chính phải chọn người thay thế',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (newPrimaryUserId.equals(userId)) {
    throw validationFailed('Người thay thế phải khác người bị gỡ');
  }
  const changed = planChangePrimary(remaining, newPrimaryUserId, actorId, now);
  return { ...changed, removedUserIds: [userId], primaryChanged: true };
};
