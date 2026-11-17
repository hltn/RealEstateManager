import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { uniqueObjectIds } from '../../../common/utils/object-id.util';
import { hasCrmRole, highestRole } from '../../../common/utils/user-roles.util';
import { Team, TeamDocument } from '../../teams/schemas/team.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  OwnerTeamCustomer,
  ownerTeamIdsOf,
} from './access/customer-owner-team';
import { OwnerRefDto } from './dtos/customer-response.dto';

/** Tài khoản người tạo khách đọc bằng MỘT truy vấn (đủ để xác định nhóm chủ VÀ dựng `creator`). */
export interface OwnerTeamCreatorUser {
  _id: Types.ObjectId;
  fullName?: string;
  roles?: string[];
  status?: UserStatus;
  deletedAt?: Date | null;
  teamId?: Types.ObjectId | null;
  teamIds?: Types.ObjectId[];
}

/** Kết quả MỘT hàm dựng ứng viên: dùng chung cho `resolveAssignee`, trường FE và lọc nhắc (T-58). */
export interface OwnerTeamCandidates {
  /** Người tạo khách (`null` khi khách cũ thiếu `createdBy` hoặc không tìm thấy user); không lọc `status`/`deletedAt`. */
  creator: OwnerTeamCreatorUser | null;
  ownerTeamIds: Types.ObjectId[];
  /** `managerIds` của các nhóm chủ chưa xóa mềm (chưa lọc vai trò/trạng thái; nơi gọi kiểm từ lần đọc `users`). */
  managerIds: Types.ObjectId[];
}

export interface OwnerRefs {
  ownerManagers: OwnerRefDto[];
  creator: OwnerRefDto | null;
}

const CREATOR_SELECT = 'teamId teamIds fullName roles status deletedAt';

const toOwnerRef = (user: OwnerTeamCreatorUser): OwnerRefDto => ({
  userId: String(user._id),
  fullName: user.fullName ?? '',
  role: highestRole(user.roles ?? []),
});

const isLive = (user: OwnerTeamCreatorUser): boolean =>
  user.status === UserStatus.ACTIVE && !user.deletedAt;

/**
 * MỘT nơi dựng "ứng viên Manager nhóm chủ và người tạo khách" (FR-30, FR-32, FR-33; Architecture 5.13.2 hàng 13). Ba nơi
 * dùng chung để BE và FE không lệch tập: `AppointmentsWriteService.resolveAssignee`, trường `ownerManagers` + `creator`
 * của chi tiết khách (`buildOwnerRefs`), bộ lọc người nhận nhắc (T-58).
 *
 * Nhóm chủ = nhóm của `createdBy` (hàm thuần `ownerTeamIdsOf`), cố định. Chỉ đọc; nhận `session` để chạy trong
 * transaction của bên gọi.
 */
@Injectable()
export class CustomerOwnerTeamService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
  ) {}

  /**
   * Đọc người tạo (MỘT truy vấn `users`, không lọc `status`/`deletedAt`) rồi `managerIds` của các nhóm chủ chưa xóa
   * mềm (MỘT truy vấn `teams`, bỏ qua khi không có nhóm chủ).
   */
  async loadCandidates(
    customer: OwnerTeamCustomer,
    session?: ClientSession,
  ): Promise<OwnerTeamCandidates> {
    const creator = customer.createdBy
      ? ((await this.userModel
          .findOne({ _id: customer.createdBy })
          .select(CREATOR_SELECT)
          .session(session ?? null)
          .lean()
          .exec()) as OwnerTeamCreatorUser | null)
      : null;
    const ownerTeamIds = ownerTeamIdsOf(customer, creator);
    const teams =
      ownerTeamIds.length === 0
        ? []
        : ((await this.teamModel
            .find({ _id: { $in: ownerTeamIds }, deletedAt: null })
            .select('managerIds')
            .session(session ?? null)
            .lean()
            .exec()) as Array<{ managerIds?: Types.ObjectId[] }>);
    const managerIds = uniqueObjectIds(
      teams.flatMap((team) => team.managerIds ?? []),
    );
    return { creator, ownerTeamIds, managerIds };
  }

  /**
   * Trường cộng thêm của chi tiết khách (FR-30). `ownerManagers`: Manager `ACTIVE` chưa xóa của nhóm chủ (gồm người
   * tạo nếu là Manager), CHƯA trong `careTeam`, sắp theo `fullName`. `creator`: người tạo `ACTIVE`, chưa xóa, có vai
   * trò CRM, KHÔNG trong `careTeam` và chưa nằm ở `ownerManagers`; ngược lại `null`. Chỉ gọi cho khách người gọi đã qua
   * phạm vi (không lộ khách ngoài phạm vi).
   */
  async buildOwnerRefs(
    customer: OwnerTeamCustomer & {
      careTeam?: Array<{ userId: Types.ObjectId }> | null;
    },
    session?: ClientSession,
  ): Promise<OwnerRefs> {
    const { creator, managerIds } = await this.loadCandidates(
      customer,
      session,
    );
    const inCareTeam = new Set(
      (customer.careTeam ?? []).map((member) => String(member.userId)),
    );
    const creatorId = creator ? String(creator._id) : null;

    const others = managerIds.filter((id) => String(id) !== creatorId);
    const managers =
      others.length > 0
        ? ((await this.userModel
            .find({
              _id: { $in: others },
              status: UserStatus.ACTIVE,
              deletedAt: null,
              roles: UserRole.MANAGER,
            })
            .select('fullName roles')
            .session(session ?? null)
            .lean()
            .exec()) as OwnerTeamCreatorUser[])
        : [];
    if (
      creator &&
      isLive(creator) &&
      creator.roles?.includes(UserRole.MANAGER)
    ) {
      managers.push(creator);
    }
    const ownerManagers = managers
      .filter((user) => !inCareTeam.has(String(user._id)))
      .map(toOwnerRef)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));

    const creatorRef =
      creator &&
      isLive(creator) &&
      hasCrmRole(creator.roles ?? []) &&
      !inCareTeam.has(String(creator._id)) &&
      !ownerManagers.some((manager) => manager.userId === String(creator._id))
        ? toOwnerRef(creator)
        : null;
    return { ownerManagers, creator: creatorRef };
  }
}
