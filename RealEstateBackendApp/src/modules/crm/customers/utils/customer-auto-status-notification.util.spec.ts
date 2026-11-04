import { Types } from 'mongoose';
import { NotificationType } from '../../../notifications/notification.constants';
import {
  AutoStatusNotificationInput,
  buildAutoStatusNotifications,
} from './customer-auto-status-notification.util';

describe('buildAutoStatusNotifications (PT-023)', () => {
  const actor = new Types.ObjectId();
  const memberB = new Types.ObjectId();
  const memberC = new Types.ObjectId();
  const customerId = new Types.ObjectId();

  const build = (over: Partial<AutoStatusNotificationInput> = {}) =>
    buildAutoStatusNotifications({
      customerId,
      customerName: 'Nguyễn Văn A',
      careTeam: [{ userId: actor }, { userId: memberB }, { userId: memberC }],
      actorId: actor,
      actorName: 'Nhân viên A',
      fromLabel: 'Có quan tâm',
      toLabel: 'Khách net',
      target: 'NET',
      version: 7,
      ...over,
    });

  it('nhiều người chăm sóc: báo mọi người TRỪ người tick', () => {
    const items = build();
    expect(items.map((item) => String(item.userId)).sort()).toEqual(
      [String(memberB), String(memberC)].sort(),
    );
    expect(items.every((item) => !item.userId.equals(actor))).toBe(true);
  });

  it('người tick là người chăm sóc duy nhất -> không có thông báo nào', () => {
    expect(build({ careTeam: [{ userId: actor }] })).toEqual([]);
  });

  it('careTeam rỗng -> không có thông báo nào', () => {
    expect(build({ careTeam: [] })).toEqual([]);
  });

  it('một người xuất hiện lặp trong careTeam chỉ nhận một thông báo', () => {
    const items = build({
      careTeam: [{ userId: memberB }, { userId: memberB }],
    });
    expect(items).toHaveLength(1);
  });

  it('chiều lên NET: loại, nội dung nêu tình trạng cũ/mới và lý do đạt 3/4', () => {
    const [item] = build();
    expect(item.type).toBe(NotificationType.CUSTOMER_STATUS_AUTO_CHANGED);
    expect(item.body).toContain('Nguyễn Văn A');
    expect(item.body).toContain('"Có quan tâm"');
    expect(item.body).toContain('"Khách net"');
    expect(item.body).toContain('đạt 3/4');
    expect(item.body).toContain('Nhân viên A');
  });

  it('chiều về INTERESTED: lý do xuống dưới 3/4', () => {
    const [item] = build({
      target: 'INTERESTED',
      fromLabel: 'Khách net',
      toLabel: 'Có quan tâm',
    });
    expect(item.body).toContain('xuống dưới 3/4');
    expect(item.body).toContain('"Khách net"');
    expect(item.body).toContain('"Có quan tâm"');
  });

  it('tình trạng cũ không rõ (null) -> nhãn dự phòng, không ném lỗi', () => {
    const [item] = build({ fromLabel: null });
    expect(item.body).toContain('"Chưa rõ"');
  });

  it('deep link và customerId đúng; dedupeKey theo (khách, version sau cùng)', () => {
    const [item] = build();
    expect(item.data.deepLink).toBe(`/crm/customers/${String(customerId)}`);
    expect(item.data.customerId).toEqual(customerId);
    expect(item.dedupeKey).toBe(`CUSTOMER_STATUS_AUTO:${String(customerId)}:7`);
    expect(build({ version: 9 })[0].dedupeKey).not.toBe(item.dedupeKey);
  });
});
