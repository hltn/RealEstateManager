import { Types } from 'mongoose';
import { NotificationType } from '../../../notifications/notification.constants';
import type { NotificationRequest } from '../../../notifications/notification-dispatcher.service';
import type { AutoStatusTarget } from './customer-rules.util';

export interface AutoStatusNotificationInput {
  customerId: Types.ObjectId;
  customerName: string;
  /** Thành viên `careTeam` của khách (chỉ cần `userId`). */
  careTeam: ReadonlyArray<{ userId: Types.ObjectId }>;
  /** Người thực hiện thao tác tick: KHÔNG được nhận thông báo (không tự báo cho chính mình). */
  actorId: Types.ObjectId;
  actorName: string;
  fromLabel: string | null;
  toLabel: string;
  target: AutoStatusTarget;
  /** `version` SAU CÙNG của khách (sau cả lần ghi tiêu chí và lần đổi tình trạng): làm khóa chống trùng. */
  version: number;
}

/**
 * PT-023 (chốt 2026-11-03): dựng thông báo "tình trạng khách vừa tự đổi" cho những người cùng chăm sóc, TRỪ người tick.
 * Hàm thuần. Mỗi người chỉ một thông báo dù xuất hiện lặp trong `careTeam`; không có người nhận thì trả mảng rỗng.
 * `dedupeKey` (`AUTOSTATUS:{khách}:{version}`, Architecture 5.2) gắn (khách, version sau cùng) nên retry cùng một lần đổi không sinh thông báo trùng, còn mỗi lần đổi
 * mới (version mới) luôn có thông báo mới. Nội dung KHÔNG chứa SĐT/CCCD.
 */
export const buildAutoStatusNotifications = ({
  customerId,
  customerName,
  careTeam,
  actorId,
  actorName,
  fromLabel,
  toLabel,
  target,
  version,
}: AutoStatusNotificationInput): NotificationRequest[] => {
  const recipientIds = new Map<string, Types.ObjectId>();
  for (const member of careTeam) {
    if (!member.userId.equals(actorId)) {
      recipientIds.set(String(member.userId), member.userId);
    }
  }
  const reason =
    target === 'NET'
      ? 'do tiến độ đạt 3/4 tiêu chí'
      : 'do tiến độ xuống dưới 3/4 tiêu chí';
  if (recipientIds.size === 0) return [];
  // Một yêu cầu cho mọi người nhận (nội dung giống nhau); `PUSH_CATALOG` cho loại này luôn có push.
  return [
    {
      type: NotificationType.CUSTOMER_STATUS_AUTO_CHANGED,
      recipientIds: [...recipientIds.values()],
      inApp: {
        title: 'Tình trạng khách tự đổi',
        body: `${actorName} vừa cập nhật tiêu chí, khách ${customerName} tự chuyển từ "${fromLabel ?? 'Chưa rõ'}" sang "${toLabel}" ${reason}`,
      },
      vars: { customerName, newStatusLabel: toLabel },
      data: {
        customerId,
        deepLink: `/crm/customers/${String(customerId)}`,
      },
      dedupeKey: `AUTOSTATUS:${String(customerId)}:${version}`,
    },
  ];
};
