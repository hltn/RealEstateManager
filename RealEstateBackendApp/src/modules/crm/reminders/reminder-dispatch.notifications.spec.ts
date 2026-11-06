import { Types } from 'mongoose';
import { NotificationType } from '../../notifications/notification.constants';
import { shouldSendPush } from '../../notifications/push/push-catalog';
import { renderPushContent } from '../../notifications/push/push-content.renderer';
import { AppointmentType } from '../appointments/appointment.constants';
import { ReminderType } from './reminder.constants';
import { ReminderDispatchService } from './reminder-dispatch.service';

/**
 * T-35: nhắc việc đi qua Dispatcher. Chỉ `APPOINTMENT_DUE` có `vars` (và push); giờ hẹn dạng `HH:mm dd/MM`;
 * `dedupeKey` giữ nguyên `reminder.dedupeKey`; phụ trách chính `HIGH`.
 */
const oid = () => new Types.ObjectId();
const CUSTOMER = oid();
const PRIMARY = oid();
const MEMBER = oid();
const APPOINTMENT = oid();

const customer = {
  _id: CUSTOMER,
  fullName: 'Anh Minh',
  careTeam: [{ userId: PRIMARY }, { userId: MEMBER }],
  primaryAssigneeId: PRIMARY,
};

const build = (appointment: unknown = null) => {
  const query = {
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(appointment),
  };
  const appointmentModel = { findOne: jest.fn().mockReturnValue(query) };
  const service = new ReminderDispatchService(
    {} as never,
    {} as never,
    appointmentModel as never,
    {} as never,
    {} as never,
    {} as never,
    { dispatch: jest.fn() } as never,
  );
  return service;
};

const reminder = (type: ReminderType, over: Record<string, unknown> = {}) =>
  ({
    _id: oid(),
    type,
    customerId: CUSTOMER,
    refId: APPOINTMENT,
    dueAt: new Date('2026-11-05T03:05:00.000Z'),
    dedupeKey: 'REM:APPT:abc:1',
    ...over,
  }) as never;

describe('ReminderDispatchService dựng yêu cầu thông báo cho Dispatcher (T-35)', () => {
  const now = new Date('2026-11-05T02:00:00.000Z');

  it('APPOINTMENT_DUE: vars đúng mẫu (loại hẹn, tên khách, giờ HH:mm dd/MM), có push, render ra đúng nội dung', async () => {
    const startAt = new Date('2026-11-05T03:05:00.000Z');
    const service = build({
      _id: APPOINTMENT,
      startAt,
      type: AppointmentType.SITE_VISIT,
      assigneeId: MEMBER,
    });
    const decision = await (service as any).evaluateAppointment(
      reminder(ReminderType.APPOINTMENT),
      customer,
      now,
      {},
    );
    expect(decision.action).toBe('SEND');
    // Người nhận: người thực hiện hẹn (MEMBER) và phụ trách chính (PRIMARY), mỗi người một yêu cầu.
    expect(decision.notifications).toHaveLength(2);
    const byUser = new Map(
      decision.notifications.map((n: any) => [String(n.recipientIds[0]), n]),
    ) as Map<string, any>;
    const toPrimary = byUser.get(String(PRIMARY))!;
    const toMember = byUser.get(String(MEMBER))!;
    expect(toPrimary.inApp.priority).toBe('HIGH');
    expect(toMember.inApp.priority).toBe('NORMAL');
    expect(toMember).toMatchObject({
      type: NotificationType.APPOINTMENT_DUE,
      dedupeKey: 'REM:APPT:abc:1',
      vars: {
        appointmentTypeLabel: 'Xem nhà mẫu',
        customerName: 'Anh Minh',
        appointmentTimeLabel: '10:05 05/11',
      },
      data: {
        customerId: CUSTOMER,
        appointmentId: APPOINTMENT,
        deepLink: `/crm/customers/${String(CUSTOMER)}?appointmentId=${String(APPOINTMENT)}`,
      },
    });
    expect(shouldSendPush(toMember.type, toMember.context)).toBe(true);
    const rendered = renderPushContent({
      type: toMember.type,
      vars: toMember.vars,
      customerId: String(CUSTOMER),
      deepLink: toMember.data.deepLink,
    });
    expect(rendered.usedFallback).toBe(false);
    expect(rendered.body).toBe(
      'Xem nhà mẫu với khách Anh Minh lúc 10:05 05/11.',
    );
  });

  it('nội dung hộp thông báo của lịch hẹn giữ như cũ (giờ đầy đủ có năm)', async () => {
    const service = build({
      _id: APPOINTMENT,
      startAt: new Date('2026-11-05T03:05:00.000Z'),
      type: AppointmentType.MEETING,
      assigneeId: MEMBER,
    });
    const decision = await (service as any).evaluateAppointment(
      reminder(ReminderType.APPOINTMENT),
      customer,
      now,
      {},
    );
    expect(decision.notifications[0].inApp).toMatchObject({
      title: 'Sắp đến giờ hẹn',
      body: 'Gặp tư vấn với khách Anh Minh lúc 10:05 05/11/2026',
    });
  });

  it('lịch đã dời giờ thì hủy, không dựng thông báo', async () => {
    const service = build({
      _id: APPOINTMENT,
      startAt: new Date('2026-11-05T04:00:00.000Z'),
      type: AppointmentType.MEETING,
      assigneeId: MEMBER,
    });
    await expect(
      (service as any).evaluateAppointment(
        reminder(ReminderType.APPOINTMENT),
        customer,
        now,
        {},
      ),
    ).resolves.toEqual({ action: 'CANCEL' });
  });

  it.each([
    [ReminderType.FOLLOW_UP, NotificationType.FOLLOW_UP_DUE],
    [ReminderType.STALE_CUSTOMER, NotificationType.STALE_CUSTOMER],
  ])(
    '%s: không vars, không push (ngoài PUSH_CATALOG), giữ dedupeKey của nhắc',
    (reminderType, notificationType) => {
      const service = build();
      const decision =
        reminderType === ReminderType.STALE_CUSTOMER
          ? (service as any).evaluateStale(reminder(reminderType), customer)
          : (service as any).buildDecision(
              reminder(reminderType),
              customer,
              [MEMBER],
              { type: notificationType, title: 't', body: 'b' },
            );
      expect(decision.action).toBe('SEND');
      for (const request of decision.notifications) {
        expect(request.type).toBe(notificationType);
        expect(request.vars).toBeUndefined();
        expect(request.dedupeKey).toBe('REM:APPT:abc:1');
        expect(shouldSendPush(request.type, request.context)).toBe(false);
      }
    },
  );

  it('không còn ai trong nhóm để nhắc thì hủy', () => {
    const service = build();
    expect(
      (service as any).buildDecision(
        reminder(ReminderType.FOLLOW_UP),
        { ...customer, careTeam: [], primaryAssigneeId: null },
        [MEMBER],
        { type: NotificationType.FOLLOW_UP_DUE, title: 't', body: 'b' },
      ),
    ).toEqual({ action: 'CANCEL' });
  });
});
