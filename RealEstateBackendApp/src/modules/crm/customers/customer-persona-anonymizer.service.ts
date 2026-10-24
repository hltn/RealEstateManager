import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Tag, TagDocument } from '../tags/schemas/tag.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';

/**
 * Ẩn danh hóa chân dung và thẻ của một khách (M4), chạy trong CÙNG transaction với việc ẩn danh hóa hồ sơ
 * (cùng mẫu `CustomerCareAnonymizerService`):
 * - chân dung (giá trị tự do về nghề nghiệp, gia đình, thói quen... là dữ liệu cá nhân) bị xóa sạch cùng token lọc,
 *   dịp đặc biệt và độ đầy đủ suy ra từ nó;
 * - thẻ gỡ khỏi khách (thẻ nghề nghiệp/sở thích có thể nhận diện người) và `usageCount` của các thẻ đó giảm tương ứng.
 */
@Injectable()
export class CustomerPersonaAnonymizerService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
  ) {}

  async anonymize(
    customerId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const customer = await this.customerModel
      .findById(customerId)
      .select('tagIds')
      .session(session)
      .lean()
      .exec();
    const tagIds = customer?.tagIds ?? [];
    if (tagIds.length > 0) {
      await this.tagModel
        .updateMany(
          { _id: { $in: tagIds } },
          { $inc: { usageCount: -1 } },
          { session, timestamps: false },
        )
        .exec();
    }
    await this.customerModel
      .updateOne(
        { _id: customerId },
        {
          $set: {
            persona: [],
            personaFilterKeys: [],
            occasions: [],
            personaCompleteness: 0,
            tagIds: [],
          },
        },
        { session, timestamps: false },
      )
      .exec();
  }
}
