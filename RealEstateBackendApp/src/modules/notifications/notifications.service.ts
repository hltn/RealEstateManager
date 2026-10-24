import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  ListNotificationsQueryDto,
  NotificationResponseDto,
} from './dtos/notification.dto';
import {
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  NotificationPriority,
  NotificationType,
} from './notification.constants';
import { isInAppEnabled } from './notification-preference.rules';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';
import { PUSH_PROVIDER } from './push/push-provider.interface';
import type { PushProvider } from './push/push-provider.interface';

/** Một thông báo cần ghi cho một người nhận. */
export interface NewNotification {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  /** KHÔNG được chứa SĐT/CCCD (tài liệu 04 mục 3.6). */
  body: string;
  data: {
    customerId?: Types.ObjectId;
    appointmentId?: Types.ObjectId;
    requestId?: Types.ObjectId;
    deepLink: string;
  };
  priority?: NotificationPriority;
  /** Cùng (userId, dedupeKey) chỉ ghi MỘT lần: job nhắc retry/chạy lại/nhiều instance không sinh thông báo trùng. */
  dedupeKey?: string;
}

type NotificationLean = Notification & { _id: Types.ObjectId };

const clip = (value: string, max: number): string =>
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
 * Hộp thông báo trong ứng dụng (tài liệu 04 mục 3.6, 05 mục 2.10) + điểm ghi thông báo chung cho mọi module.
 *
 * Ghi (`createMany`): bỏ người đã tắt `inApp` cho loại đó; có `dedupeKey` thì upsert theo (userId, dedupeKey) nên
 * KHÔNG bao giờ ném E11000 (an toàn trong transaction); `pushStatus` lấy từ `PushProvider` (M5: `SKIPPED`).
 * Đọc/đánh dấu: luôn lọc theo `userId` của người gọi — thông báo của người khác trả 404 như không tồn tại.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  /**
   * Ghi thông báo cho nhiều người. Trả số thông báo MỚI thật sự được tạo (không tính bản trùng `dedupeKey`
   * hoặc người đã tắt loại này). Truyền `session` để ghi cùng transaction với thay đổi nghiệp vụ.
   */
  async createMany(
    items: NewNotification[],
    session?: ClientSession,
  ): Promise<number> {
    if (items.length === 0) return 0;

    const userIds = [...new Set(items.map((item) => String(item.userId)))].map(
      (id) => new Types.ObjectId(id),
    );
    const preferences = await this.preferenceModel
      .find({ userId: { $in: userIds } })
      .select('userId types')
      .session(session ?? null)
      .lean()
      .exec();
    const typesByUser = new Map(
      preferences.map((pref) => [String(pref.userId), pref.types]),
    );
    const wanted = items.filter((item) =>
      isInAppEnabled(typesByUser.get(String(item.userId)), item.type),
    );
    if (wanted.length === 0) return 0;

    const now = new Date();
    const operations = wanted.map((item) => {
      const doc = {
        userId: item.userId,
        type: item.type,
        title: clip(item.title, NOTIFICATION_TITLE_MAX_LENGTH),
        body: clip(item.body, NOTIFICATION_BODY_MAX_LENGTH),
        data: {
          customerId: item.data.customerId ?? null,
          appointmentId: item.data.appointmentId ?? null,
          requestId: item.data.requestId ?? null,
          deepLink: item.data.deepLink,
        },
        priority: item.priority ?? NotificationPriority.NORMAL,
        readAt: null,
        pushStatus: this.push.initialStatus(),
        dedupeKey: item.dedupeKey ?? null,
        createdAt: now,
      };
      return item.dedupeKey
        ? {
            updateOne: {
              filter: { userId: item.userId, dedupeKey: item.dedupeKey },
              update: { $setOnInsert: doc },
              upsert: true,
            },
          }
        : { insertOne: { document: doc } };
    });
    const result = await this.notificationModel.bulkWrite(operations, {
      session,
      ordered: false,
      timestamps: false,
    });
    return result.insertedCount + result.upsertedCount;
  }

  /** Gửi cho mọi Quản trị đang hoạt động (cảnh báo bảo mật). Lỗi chỉ ghi log: không làm hỏng nghiệp vụ gốc. */
  async notifyAdmins(
    item: Omit<NewNotification, 'userId'>,
    session?: ClientSession,
  ): Promise<number> {
    try {
      const admins = await this.userModel
        .find({
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        })
        .select('_id')
        .session(session ?? null)
        .lean()
        .exec();
      return await this.createMany(
        admins.map((admin) => ({ ...item, userId: admin._id })),
        session,
      );
    } catch (error) {
      this.logger.warn(
        `Không gửi được thông báo cho Quản trị (${item.type}): ${(error as Error).message}`,
      );
      return 0;
    }
  }

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
