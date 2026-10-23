import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';

const BATCH_SIZE = 1000;

/** `teamIds` mới của một khách = hợp `teamId` hiện tại của các thành viên chăm sóc (bỏ người chưa có nhóm). */
export const computeTeamIds = (
  memberIds: Types.ObjectId[],
  teamOfUser: Map<string, Types.ObjectId | null>,
): Types.ObjectId[] => {
  const teams = new Map<string, Types.ObjectId>();
  for (const memberId of memberIds) {
    const teamId = teamOfUser.get(String(memberId));
    if (teamId) teams.set(String(teamId), teamId);
  }
  return [...teams.values()];
};

const sameSet = (a: Types.ObjectId[], b: Types.ObjectId[]): boolean => {
  if (a.length !== b.length) return false;
  const left = new Set(a.map(String));
  return b.every((id) => left.has(String(id)));
};

/**
 * Đồng bộ `customers.teamIds` khi nhóm của một người dùng đổi (`PATCH /users/:id/team`, hoặc đổi vai trò làm
 * mất nhóm). `teamIds` là cơ sở phạm vi của Quản lý nên phải được tính lại NGAY trong cùng transaction với việc đổi
 * nhóm — không để job nền, tránh khoảng thời gian Quản lý nhóm cũ vẫn thấy khách.
 *
 * Chỉ xử lý khách có người này trong `careTeam` (kể cả khách xóa mềm để khôi phục về sau vẫn đúng). Khách chưa có
 * `careTeam` giữ `teamIds` = nhóm của người tạo tại thời điểm tạo (ảnh chụp, không đổi theo người tạo).
 */
@Injectable()
export class CustomerTeamSyncService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** Trả số khách được cập nhật `teamIds`. */
  async syncForUser(
    userId: Types.ObjectId,
    session: ClientSession,
  ): Promise<number> {
    const customers = await this.customerModel
      .find({ 'careTeam.userId': userId })
      .select('careTeam.userId teamIds')
      .session(session)
      .lean()
      .exec();
    if (customers.length === 0) return 0;

    const memberIds = [
      ...new Map(
        customers
          .flatMap((customer) => customer.careTeam.map((m) => m.userId))
          .map((id) => [String(id), id]),
      ).values(),
    ];
    const users = await this.userModel
      .find({ _id: { $in: memberIds } })
      .select('teamId')
      .session(session)
      .lean()
      .exec();
    const teamOfUser = new Map(
      users.map((user) => [String(user._id), user.teamId ?? null]),
    );

    const operations = customers.flatMap((customer) => {
      const teamIds = computeTeamIds(
        customer.careTeam.map((member) => member.userId),
        teamOfUser,
      );
      if (sameSet(teamIds, customer.teamIds ?? [])) return [];
      return [
        {
          updateOne: {
            filter: { _id: customer._id },
            update: { $set: { teamIds } },
          },
        },
      ];
    });

    for (let index = 0; index < operations.length; index += BATCH_SIZE) {
      await this.customerModel.bulkWrite(
        operations.slice(index, index + BATCH_SIZE),
        { session, timestamps: false },
      );
    }
    return operations.length;
  }
}
