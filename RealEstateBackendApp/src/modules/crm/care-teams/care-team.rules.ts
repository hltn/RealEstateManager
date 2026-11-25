import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmActor } from '../common/access/crm-actor';
import { isAdminOrManager } from '../customers/access/customer-scope';
import { CareRole } from '../customers/customer.constants';
import { CareTeamEntry } from '../customers/schemas/customer.schema';
import { MAX_CARE_TEAM_MEMBERS } from './care-team.constants';

/** `details.reason` của 409 `PRIMARY_LOCKED` khi gỡ người tạo khách (FE phân biệt với gỡ PRIMARY thường). */
export const CREATOR_LOCKED_REASON = 'CREATOR_LOCKED';

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

/**
 * Giới hạn thành viên phụ (FR-17): sau thay đổi có THÊM người mà số MEMBER vượt `MAX_CARE_TEAM_MEMBERS` ⇒ 409
 * `CARE_TEAM_LIMIT_EXCEEDED`. Thay đổi không thêm ai (gỡ người) luôn qua, nên khách cũ đã quá 10 vẫn gỡ được
 * (không ép gỡ, chỉ chặn thêm). Gọi trong transaction của lần ghi (cùng khóa `__v`) để hai lời mời đồng thời
 * không cùng vượt trần.
 */
export const assertMemberLimit = (change: CareTeamChange): void => {
  if (change.addedUserIds.length === 0) return;
  const members = change.careTeam.filter(
    (member) => member.role === CareRole.MEMBER,
  ).length;
  if (members > MAX_CARE_TEAM_MEMBERS) {
    throw new BusinessException(
      ErrorCode.CARE_TEAM_LIMIT_EXCEEDED,
      `Mỗi khách chỉ có tối đa ${MAX_CARE_TEAM_MEMBERS} thành viên phụ`,
      HttpStatus.CONFLICT,
      { limit: MAX_CARE_TEAM_MEMBERS, membersAfter: members },
    );
  }
};

/**
 * Người tạo khách KHÔNG BAO GIỜ bị gỡ khỏi `careTeam` (FR-31, Q-45): mọi lần gỡ (PRIMARY hay MEMBER; người gỡ là Admin,
 * Manager, PRIMARY hay chính người tạo) là 409 `PRIMARY_LOCKED` kèm `details.reason = CREATOR_LOCKED` (tái dùng mã cũ,
 * `reason` để FE phân biệt với gỡ PRIMARY thường).
 */
const creatorLocked = (): BusinessException =>
  new BusinessException(
    ErrorCode.PRIMARY_LOCKED,
    'Người tạo khách không thể bị gỡ khỏi nhóm chăm sóc',
    HttpStatus.CONFLICT,
    { reason: CREATOR_LOCKED_REASON },
  );

/**
 * Backstop (FR-31): `createdBy` có trong `careTeam` TRƯỚC mà không còn SAU thay đổi => 409 `PRIMARY_LOCKED` +
 * `CREATOR_LOCKED`, áp cho MỌI vai trò và MỌI đường (gỡ, thay PRIMARY, thay cả nhóm). `applyInSession` gọi ngay sau
 * `plan` nên đường tương lai cũng đi qua một cổng. Khách thiếu `createdBy`, hoặc người tạo vốn không trong nhóm trước,
 * thì không có gì để giữ.
 */
export const assertCreatorKept = (
  before: CareTeamEntry[],
  after: CareTeamEntry[],
  createdBy: Types.ObjectId | null | undefined,
): void => {
  if (!createdBy || !hasUser(before, createdBy)) return;
  if (!hasUser(after, createdBy)) throw creatorLocked();
};

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
 * Gỡ thành viên. Gỡ người không có trong nhóm: 404. Gỡ NGƯỜI TẠO (`createdBy`; PRIMARY hay MEMBER) luôn là 409
 * `PRIMARY_LOCKED` kèm `details.reason = CREATOR_LOCKED` (FR-31), kiểm TRƯỚC nhánh PRIMARY. Gỡ PRIMARY không phải
 * người tạo (kể cả Quản trị/Quản lý, kể cả qua thao tác hàng loạt) vẫn là 409 `PRIMARY_LOCKED` không `reason` (FR-11).
 */
export const planRemoveMember = (
  current: CareTeamEntry[],
  userId: Types.ObjectId,
  createdBy: Types.ObjectId | null | undefined,
): CareTeamChange => {
  const target = current.find((member) => member.userId.equals(userId));
  if (!target) {
    throw new BusinessException(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Người này không có trong nhóm chăm sóc',
      HttpStatus.NOT_FOUND,
    );
  }
  if (createdBy && target.userId.equals(createdBy)) throw creatorLocked();
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
