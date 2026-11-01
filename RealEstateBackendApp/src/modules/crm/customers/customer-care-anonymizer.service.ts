import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CareTeamRequestStatus } from '../care-teams/care-team.constants';
import {
  CareTeamRequest,
  CareTeamRequestDocument,
} from '../care-teams/schemas/care-team-request.schema';
import { AttachmentStatus } from '../care-logs/care-log.constants';
import { CareLog, CareLogDocument } from '../care-logs/schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentDocument,
} from '../care-logs/schemas/crm-attachment.schema';
import { ANONYMIZED_PLACEHOLDER } from './customer.constants';

/**
 * Ẩn danh hóa dữ liệu chăm sóc của một khách (M3), chạy trong CÙNG transaction với việc ẩn danh hóa hồ sơ:
 * - nhật ký: ghi đè nội dung và gợi ý bước tiếp theo (văn bản tự do, có thể chứa PII), bỏ danh sách ảnh;
 * - ảnh đính kèm: đánh dấu REMOVED và xóa tên file gốc. File thật trong kho lưu trữ do `AttachmentCleanupService`
 *   xóa sau đó (không gọi mạng bên trong transaction);
 * - đề nghị tham gia: xóa lời nhắn/ghi chú, đề nghị đang chờ bị hủy.
 * Giữ khung thống kê (kênh liên hệ, kết quả liên hệ, thời điểm, người viết).
 */
@Injectable()
export class CustomerCareAnonymizerService {
  constructor(
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    @InjectModel(CrmAttachment.name)
    private readonly attachmentModel: Model<CrmAttachmentDocument>,
    @InjectModel(CareTeamRequest.name)
    private readonly requestModel: Model<CareTeamRequestDocument>,
  ) {}

  async anonymize(
    customerId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    await this.careLogModel
      .updateMany(
        { customerId },
        [
          {
            $set: {
              content: ANONYMIZED_PLACEHOLDER,
              attachments: [],
              nextAction: {
                $cond: [
                  { $eq: [{ $type: '$nextAction' }, 'object'] },
                  { $mergeObjects: ['$nextAction', { suggestion: null }] },
                  '$nextAction',
                ],
              },
            },
          },
        ],
        { session, timestamps: false, updatePipeline: true },
      )
      .exec();

    await this.attachmentModel
      .updateMany(
        { customerId },
        [
          {
            $set: {
              originalName: '',
              status: AttachmentStatus.REMOVED,
              removedAt: { $ifNull: ['$removedAt', now] },
            },
          },
        ],
        { session, timestamps: false, updatePipeline: true },
      )
      .exec();

    await this.requestModel
      .updateMany(
        { customerId },
        { $set: { message: null, resolutionNote: null } },
        { session, timestamps: false },
      )
      .exec();
    await this.requestModel
      .updateMany(
        { customerId, status: CareTeamRequestStatus.PENDING },
        { $set: { status: CareTeamRequestStatus.CANCELED, resolvedAt: now } },
        { session, timestamps: false },
      )
      .exec();
  }
}
