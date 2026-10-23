import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Nhóm làm việc (tài liệu 04 mục 3.3) — cơ sở của phạm vi khách của Quản lý.
 *
 * - `code`: duy nhất toàn hệ thống (kể cả nhóm đã xóa mềm), lưu chữ HOA.
 * - `managerIds`: danh sách Quản lý của nhóm (người dùng vai trò MANAGER).
 * - Thành viên của nhóm KHÔNG lưu ở đây mà ở `users.teamId` (một nguồn sự thật duy nhất).
 * - Xóa mềm bằng `deletedAt`.
 */
@Schema({ timestamps: true, collection: 'teams' })
export class Team {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ required: true, trim: true, uppercase: true, maxlength: 20 })
  code: string;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  managerIds: Types.ObjectId[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  /**
   * Bộ đếm "khóa ghi": tăng khi gán người vào nhóm; xóa nhóm cũng ghi vào document này nên hai thao tác đồng thời
   * xung đột ghi (không để người dùng trỏ vào nhóm đã xóa do write-skew).
   */
  @Prop({ default: 0 })
  revision: number;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type TeamDocument = HydratedDocument<Team>;

export const TeamSchema = SchemaFactory.createForClass(Team);

// Mã nhóm duy nhất toàn hệ thống, kể cả nhóm đã xóa mềm (tránh tái dùng mã gây nhầm lẫn lịch sử).
TeamSchema.index({ code: 1 }, { unique: true });
// Tra "các nhóm tôi quản lý" khi dựng phạm vi khách của Quản lý.
TeamSchema.index({ managerIds: 1 });
