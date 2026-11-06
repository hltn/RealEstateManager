import { Types } from 'mongoose';
import {
  NotificationPriority,
  NotificationType,
} from '../../../notifications/notification.constants';
import { shouldSendPush } from '../../../notifications/push/push-catalog';
import { CrmAuditAction } from '../../audit-logs/crm-audit.constants';
import { CrmAbuseMonitorService } from './crm-abuse-monitor.service';

/** T-35: cảnh báo bảo mật đi qua `NotificationDispatcher.notifyAdmins`, giữ `ALERT:...` và không push. */
describe('CrmAbuseMonitorService.notifyAdmins qua Dispatcher (T-35)', () => {
  const userId = String(new Types.ObjectId());

  const build = (displayName: string | null) => {
    const notifyAdmins = jest.fn().mockResolvedValue(1);
    const connection = {
      collection: jest.fn().mockReturnValue({
        findOne: jest
          .fn()
          .mockResolvedValue(displayName ? { displayName } : null),
      }),
    };
    const service = new CrmAbuseMonitorService(
      {} as never,
      connection as never,
      {} as never,
      { notifyAdmins } as never,
    );
    return { service, notifyAdmins };
  };

  const run = (service: CrmAbuseMonitorService) =>
    (service as any).notifyAdmins(
      userId,
      CrmAuditAction.PHONE_SEARCH_ANOMALY,
      'Vượt 30 lượt trong 1 giờ (hiện 31)',
    ) as Promise<void>;

  it('gửi SECURITY_ALERT mức HIGH với tên người dùng, deep link audit và dedupeKey ALERT theo giờ', async () => {
    const { service, notifyAdmins } = build('Lan');
    await run(service);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    const request = notifyAdmins.mock.calls[0][0];
    expect(request).toMatchObject({
      type: NotificationType.SECURITY_ALERT,
      inApp: {
        title: 'Cảnh báo truy cập bất thường',
        body: 'Lan: Vượt 30 lượt trong 1 giờ (hiện 31)',
        priority: NotificationPriority.HIGH,
      },
    });
    expect(request.data.deepLink).toContain(
      `/crm/audit-logs?actorId=${userId}`,
    );
    expect(request.dedupeKey).toMatch(new RegExp(`^ALERT:.+:${userId}:\\d+$`));
    expect(request.recipientIds).toBeUndefined();
    expect(shouldSendPush(request.type, request.context)).toBe(false);
  });

  it('không tìm được tên thì dùng nhãn dự phòng, vẫn gửi cảnh báo', async () => {
    const { service, notifyAdmins } = build(null);
    await run(service);
    expect(notifyAdmins.mock.calls[0][0].inApp.body).toMatch(
      /^Một người dùng: /,
    );
  });
});
