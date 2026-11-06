import { Types } from 'mongoose';
import {
  NotificationPriority,
  NotificationType,
} from '../../../notifications/notification.constants';
import type { NotificationRequest } from '../../../notifications/notification-dispatcher.service';
import { CareRole } from '../customer.constants';

export interface CustomerCreatedNotificationInput {
  customerId: Types.ObjectId;
  customerName: string;
  /** Nhóm chăm sóc ban đầu (chỉ cần `userId`, `role`). */
  careTeam: ReadonlyArray<{ userId: Types.ObjectId; role: CareRole }>;
  /** Người tạo khách: KHÔNG nhận thông báo (không tự báo cho chính mình). */
  actorId: Types.ObjectId;
  actorName: string;
}

/**
 * Dựng thông báo "được phân chăm sóc khách mới" lúc TẠO khách (Architecture 5.2). Hàm thuần.
 * Mỗi người một yêu cầu vì độ ưu tiên (phụ trách chính `HIGH`) và `careRole` khác nhau. `origin = CUSTOMER_CREATED`
 * làm `pushWhen` của `CUSTOMER_ASSIGNED` luôn sai: chỉ có hộp thông báo, không push. `dedupeKey` theo khách.
 */
export const buildCustomerCreatedNotifications = ({
  customerId,
  customerName,
  careTeam,
  actorId,
  actorName,
}: CustomerCreatedNotificationInput): NotificationRequest[] =>
  careTeam
    .filter((member) => !member.userId.equals(actorId))
    .map((member) => {
      const isPrimary = member.role === CareRole.PRIMARY;
      return {
        type: NotificationType.CUSTOMER_ASSIGNED,
        recipientIds: [member.userId],
        inApp: {
          title: 'Bạn được phân chăm sóc khách mới',
          body: `Bạn được phân chăm sóc khách ${customerName}`,
          priority: isPrimary
            ? NotificationPriority.HIGH
            : NotificationPriority.NORMAL,
        },
        vars: { actorName, customerName },
        data: {
          customerId,
          deepLink: `/crm/customers/${String(customerId)}`,
        },
        context: {
          careRole: isPrimary ? ('PRIMARY' as const) : ('MEMBER' as const),
          origin: 'CUSTOMER_CREATED' as const,
        },
        dedupeKey: `ASSIGN:CREATE:${String(customerId)}`,
      };
    });
