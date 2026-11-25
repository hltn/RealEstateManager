import { Types } from 'mongoose';
import {
  NotificationPriority,
  NotificationType,
} from '../../../notifications/notification.constants';
import { shouldSendPush } from '../../../notifications/push/push-catalog';
import { CareRole } from '../customer.constants';
import { buildCustomerCreatedNotifications } from './customer-created-notification.util';

describe('buildCustomerCreatedNotifications (T-34)', () => {
  const actor = new Types.ObjectId();
  const primary = new Types.ObjectId();
  const member = new Types.ObjectId();
  const customerId = new Types.ObjectId();

  const build = (careTeam: Array<{ userId: Types.ObjectId; role: CareRole }>) =>
    buildCustomerCreatedNotifications({
      customerId,
      customerName: 'Anh Minh',
      careTeam,
      actorId: actor,
      actorName: 'Lan',
    });

  it('bỏ người tạo, mỗi người còn lại một yêu cầu; PRIMARY HIGH, MEMBER NORMAL; nội dung in-app giữ như cũ', () => {
    const requests = build([
      { userId: actor, role: CareRole.MEMBER },
      { userId: primary, role: CareRole.PRIMARY },
      { userId: member, role: CareRole.MEMBER },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      type: NotificationType.CUSTOMER_ASSIGNED,
      recipientIds: [primary],
      inApp: {
        title: 'Bạn được phân chăm sóc khách mới',
        body: 'Bạn được phân chăm sóc khách Anh Minh',
        priority: NotificationPriority.HIGH,
      },
      vars: { actorName: 'Lan', customerName: 'Anh Minh' },
      dedupeKey: `ASSIGN:CREATE:${String(customerId)}`,
    });
    expect(requests[1].inApp.priority).toBe(NotificationPriority.NORMAL);
    expect(requests[0].data).toEqual({
      customerId,
      deepLink: `/crm/customers/${String(customerId)}`,
    });
  });

  it('origin = CUSTOMER_CREATED nên KHÔNG push dù là MEMBER hay PRIMARY', () => {
    const requests = build([
      { userId: primary, role: CareRole.PRIMARY },
      { userId: member, role: CareRole.MEMBER },
    ]);
    for (const request of requests) {
      expect(request.context?.origin).toBe('CUSTOMER_CREATED');
      expect(shouldSendPush(request.type, request.context)).toBe(false);
    }
  });

  it('người tạo là người duy nhất trong nhóm thì không có yêu cầu nào', () => {
    expect(build([{ userId: actor, role: CareRole.PRIMARY }])).toEqual([]);
  });

  it('FR-10: người tạo là PRIMARY duy nhất (mọi vai trò, kể cả Admin teamIds=[]) hoặc careTeam rỗng => không thông báo', () => {
    expect(build([{ userId: actor, role: CareRole.PRIMARY }])).toHaveLength(0);
    expect(build([])).toEqual([]);
  });
});
