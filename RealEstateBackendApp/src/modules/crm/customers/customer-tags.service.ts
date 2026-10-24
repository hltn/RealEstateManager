import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { Tag, TagDocument } from '../tags/schemas/tag.schema';

/**
 * Giữ `tags.usageCount` khớp với `customers.tagIds`: MỌI thay đổi thẻ của khách đi qua `applyDelta` trong CÙNG
 * transaction với việc ghi khách. Ghi `$inc` vào document thẻ cũng là "khóa ghi": nó xung đột ghi với việc Quản trị xóa/gộp
 * thẻ đồng thời (bên kia chạy lại và thấy thẻ đã xóa) nên không thể gắn thẻ vừa bị xóa/gộp (write-skew).
 */
@Injectable()
export class CustomerTagsService {
  constructor(
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
  ) {}

  /** Kiểm tra TRƯỚC (ngoài transaction) mọi thẻ còn tồn tại, để thẻ sai trả 400 cho cả lô thay vì từng khách. */
  async assertAllActive(tagIds: Types.ObjectId[]): Promise<void> {
    const found = await this.tagModel
      .countDocuments({ _id: { $in: tagIds }, deletedAt: null })
      .exec();
    if (found !== new Set(tagIds.map(String)).size) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Thẻ không tồn tại hoặc đã bị xóa',
        HttpStatus.BAD_REQUEST,
        { field: 'payload.tagIds' },
      );
    }
  }

  /**
   * `added`: thẻ MỚI gắn (phải còn tồn tại, chưa xóa => nếu không 400); `removed`: thẻ bị gỡ (thẻ đã bị xóa vẫn
   * được gỡ bình thường). Hai danh sách không giao nhau và không trùng phần tử (do `diffTagIds`).
   */
  async applyDelta(
    delta: { added: Types.ObjectId[]; removed: Types.ObjectId[] },
    session: ClientSession,
  ): Promise<void> {
    if (delta.added.length > 0) {
      const result = await this.tagModel
        .updateMany(
          { _id: { $in: delta.added }, deletedAt: null },
          { $inc: { usageCount: 1 } },
          { session, timestamps: false },
        )
        .exec();
      if (result.matchedCount !== delta.added.length) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          'Thẻ không tồn tại hoặc đã bị xóa',
          HttpStatus.BAD_REQUEST,
          { field: 'tagIds' },
        );
      }
    }
    if (delta.removed.length > 0) {
      await this.tagModel
        .updateMany(
          { _id: { $in: delta.removed } },
          { $inc: { usageCount: -1 } },
          { session, timestamps: false },
        )
        .exec();
    }
  }
}
