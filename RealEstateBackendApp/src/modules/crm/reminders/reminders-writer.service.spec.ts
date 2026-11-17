import { Types } from 'mongoose';
import { AppointmentStatus } from '../appointments/appointment.constants';
import { RemindersWriterService } from './reminders-writer.service';

const oid = () => new Types.ObjectId();

const build = () => {
  const reminderModel = {
    bulkWrite: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
    find: jest.fn(),
  };
  const service = new RemindersWriterService(
    reminderModel as never,
    {} as never,
    {} as never,
  );
  return { service, reminderModel };
};

const session = {} as never;
const now = new Date('2026-10-01T00:00:00.000Z');
const appointment = (extra: Record<string, unknown>) => ({
  _id: oid(),
  customerId: oid(),
  startAt: new Date('2026-10-30T02:00:00.000Z'),
  status: AppointmentStatus.SCHEDULED,
  remindBeforeMinutes: [60],
  ...extra,
});

const recipientsOf = (
  reminderModel: ReturnType<typeof build>['reminderModel'],
) => {
  const [ops] = reminderModel.bulkWrite.mock.calls[0] as [
    Array<{
      updateOne: {
        update: { $setOnInsert: { recipientIds: Types.ObjectId[] } };
      };
    }>,
  ];
  return ops.map((op) => op.updateOne.update.$setOnInsert.recipientIds);
};

describe('RemindersWriterService.syncAppointment: recipientIds (FR-30)', () => {
  it('FR-30: lịch nhiều người thực hiện thì recipientIds là đủ danh sách assigneeIds', async () => {
    const { service, reminderModel } = build();
    const [a, b, c] = [oid(), oid(), oid()];
    await service.syncAppointment(
      appointment({ assigneeIds: [b, a, c], assigneeId: b }),
      now,
      session,
    );
    expect(recipientsOf(reminderModel)).toEqual([[b, a, c]]);
  });

  it('FR-30 (chưa backfill): lịch cũ chỉ có assigneeId thì recipientIds = [assigneeId]', async () => {
    const { service, reminderModel } = build();
    const a = oid();
    await service.syncAppointment(appointment({ assigneeId: a }), now, session);
    expect(recipientsOf(reminderModel)).toEqual([[a]]);
  });

  it('FR-30: assigneeIds thắng assigneeId lệch', async () => {
    const { service, reminderModel } = build();
    const [a, b] = [oid(), oid()];
    await service.syncAppointment(
      appointment({ assigneeIds: [b], assigneeId: a }),
      now,
      session,
    );
    expect(recipientsOf(reminderModel)).toEqual([[b]]);
  });
});
