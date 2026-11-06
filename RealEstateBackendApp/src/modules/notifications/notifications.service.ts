import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import {
  ListNotificationsQueryDto,
  NotificationResponseDto,
} from './dtos/notification.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

type NotificationLean = Notification & { _id: Types.ObjectId };

export const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const notificationNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Không tìm thấy thông báo',
    HttpStatus.NOT_FOUND,
  );

export const toNotificationResponse = (
  row: NotificationLean,
): NotificationResponseDto => ({
  id: String(row._id),
  type: row.type,
  title: row.title,
  body: row.body,
  data: {
    ...(row.data.customerId && { customerId: String(row.data.customerId) }),
    ...(row.data.appointmentId && {
      appointmentId: String(row.data.appointmentId),
    }),
    ...(row.data.requestId && { requestId: String(row.data.requestId) }),
    deepLink: row.data.deepLink,
  },
  priority: row.priority,
  readAt: row.readAt ? row.readAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Hộp thông báo trong ứng dụng (tài liệu 04 mục 3.6, 05 mục 2.10): CHỈ đọc/đánh dấu. Việc ghi thông báo đi qua
 * `NotificationDispatcher` (điểm vào duy nhất, FR-44).
 * Đọc/đánh dấu: luôn lọc theo `userId` của người gọi — thông báo của người khác trả 404 như không tồn tại.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<{ data: NotificationResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      ...(query.isRead !== undefined && {
        readAt: query.isRead ? { $ne: null } : null,
      }),
      ...(query.types?.length && { type: { $in: query.types } }),
    };
    const [rows, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);
    return {
      data: (rows as NotificationLean[]).map(toNotificationResponse),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({ userId: new Types.ObjectId(userId), readAt: null })
      .exec();
  }

  /** Đánh dấu một thông báo của CHÍNH MÌNH đã đọc/chưa đọc; đã đọc rồi thì giữ nguyên mốc `readAt` đầu tiên. */
  async setRead(
    userId: string,
    id: string,
    isRead: boolean,
  ): Promise<NotificationResponseDto> {
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        [
          {
            $set: {
              readAt: isRead ? { $ifNull: ['$readAt', new Date()] } : null,
            },
          },
        ],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean()
      .exec();
    if (!updated) throw notificationNotFound();
    return toNotificationResponse(updated);
  }

  /** Đánh dấu đã đọc hàng loạt: `ids` bỏ trống = mọi thông báo chưa đọc của mình; `before` giới hạn theo thời điểm tạo. */
  async markManyRead(
    userId: string,
    options: { ids?: string[]; before?: string },
  ): Promise<number> {
    const result = await this.notificationModel
      .updateMany(
        {
          userId: new Types.ObjectId(userId),
          readAt: null,
          ...(options.ids && {
            _id: { $in: options.ids.map((id) => new Types.ObjectId(id)) },
          }),
          ...(options.before && {
            createdAt: { $lt: new Date(options.before) },
          }),
        },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return result.modifiedCount;
  }
}
