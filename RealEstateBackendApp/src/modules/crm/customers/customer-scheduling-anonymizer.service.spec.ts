import { Types } from 'mongoose';
import { CustomerSchedulingAnonymizerService } from './customer-scheduling-anonymizer.service';

/** T-35: ẩn danh hóa khách xóa cả bản ghi thông báo của khách (kèm `push` dựng sẵn có tên khách), trong cùng transaction. */
describe('CustomerSchedulingAnonymizerService.anonymize (T-35)', () => {
  const customerId = new Types.ObjectId();
  const now = new Date();
  const session = { id: 's' } as never;

  const build = () => {
    const exec = jest.fn().mockResolvedValue({});
    const appointmentModel = {
      updateMany: jest.fn().mockReturnValue({ exec }),
    };
    const notificationModel = {
      deleteMany: jest.fn().mockReturnValue({ exec }),
    };
    const reminders = { cancelForCustomer: jest.fn().mockResolvedValue(0) };
    const service = new CustomerSchedulingAnonymizerService(
      appointmentModel as never,
      notificationModel as never,
      reminders as never,
    );
    return { service, appointmentModel, notificationModel, reminders };
  };

  it('xóa mọi thông báo của khách (không giữ bản ghi còn `push`), cùng session', async () => {
    const { service, notificationModel } = build();
    await service.anonymize(customerId, now, session);
    expect(notificationModel.deleteMany).toHaveBeenCalledWith(
      { 'data.customerId': customerId },
      { session },
    );
  });

  it('vẫn ghi đè lịch hẹn và hủy nhắc việc chưa gửi', async () => {
    const { service, appointmentModel, reminders } = build();
    await service.anonymize(customerId, now, session);
    expect(appointmentModel.updateMany.mock.calls[0][0]).toEqual({
      customerId,
    });
    expect(reminders.cancelForCustomer).toHaveBeenCalledWith(
      customerId,
      now,
      session,
    );
  });
});
