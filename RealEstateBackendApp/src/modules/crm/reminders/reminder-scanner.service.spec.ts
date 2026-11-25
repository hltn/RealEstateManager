import { Types } from 'mongoose';
import { ListGroup } from '../catalogs/catalog.enums';
import { ReminderScannerService } from './reminder-scanner.service';

const NOW = new Date('2026-10-30T02:00:00.000Z');

const chain = <T>(result: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const name of ['select', 'lean']) query[name] = jest.fn(() => query);
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
};

const build = (statusCodes: string[]) => {
  const rows = statusCodes.map((code) => ({ _id: new Types.ObjectId(), code }));
  const statusModel = { find: jest.fn(() => chain(rows)) };
  const customers = { findForSystemJobBatch: jest.fn().mockResolvedValue([]) };
  const settings = {
    get: jest
      .fn()
      .mockResolvedValue({ occasionLeadDays: [0], staleCustomerDays: 14 }),
  };
  const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0 });
  const service = new ReminderScannerService(
    { bulkWrite } as never,
    statusModel as never,
    customers as never,
    settings as never,
  );
  return { service, statusModel, customers, rows, bulkWrite };
};

describe('ReminderScannerService: lọc tình trạng theo statusCode (FR-40)', () => {
  it('FR-40: quét khách lâu chưa chăm sóc lọc statusCode thuộc NOT_CONTACTED/INTERESTED, dự phòng statusId cho khách chưa backfill', async () => {
    const { service, statusModel, customers, rows } = build([
      'NET',
      'INTERESTED',
    ]);

    await service.scanStale(NOW);

    expect(statusModel.find).toHaveBeenCalledWith({
      listGroup: { $in: [ListGroup.NOT_CONTACTED, ListGroup.INTERESTED] },
    });
    const [filter] = customers.findForSystemJobBatch.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter.$and).toContainEqual({
      $or: [
        { statusCode: { $in: ['NET', 'INTERESTED'] } },
        { statusCode: null, statusId: { $in: rows.map((row) => row._id) } },
      ],
    });
  });

  it('FR-40: quét dịp đặc biệt loại khách theo statusCode thuộc DROPPED, kể cả khách chưa backfill (theo statusId)', async () => {
    const { service, statusModel, customers, rows } = build(['DROPPED']);

    await service.scanOccasions(NOW);

    expect(statusModel.find).toHaveBeenCalledWith({
      listGroup: { $in: [ListGroup.DROPPED] },
    });
    const [filter] = customers.findForSystemJobBatch.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter.$nor).toEqual([
      { statusCode: { $in: ['DROPPED'] } },
      { statusCode: null, statusId: { $in: rows.map((row) => row._id) } },
    ]);
  });

  it('FR-19: scanStale không lọc theo primaryAssigneeId (PRIMARY null vẫn quét), chỉ yêu cầu careTeam không rỗng', async () => {
    const { service, customers } = build(['NET']);

    await service.scanStale(NOW);

    const [filter, options] = customers.findForSystemJobBatch.mock.calls[0] as [
      Record<string, unknown>,
      { projection: string },
    ];
    expect(filter['careTeam.0']).toEqual({ $exists: true });
    expect(filter).not.toHaveProperty('primaryAssigneeId');
    expect(options.projection).toContain('careTeam.userId');
  });

  it('FR-19: khách có careTeam nhưng PRIMARY null được tạo nhắc STALE với recipientIds là careTeam và priorityRecipientId null', async () => {
    const { service, customers, bulkWrite } = build(['NET']);
    const memberId = new Types.ObjectId();
    customers.findForSystemJobBatch.mockResolvedValueOnce([
      {
        _id: new Types.ObjectId(),
        primaryAssigneeId: null,
        careTeam: [{ userId: memberId }],
        lastCareLogAt: new Date('2026-09-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);

    await service.scanStale(NOW);

    const ops = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: {
        update: {
          $setOnInsert: {
            recipientIds: Types.ObjectId[];
            priorityRecipientId: Types.ObjectId | null;
          };
        };
      };
    }>;
    expect(ops).toHaveLength(1);
    const inserted = ops[0].updateOne.update.$setOnInsert;
    expect(inserted.recipientIds).toEqual([memberId]);
    expect(inserted.priorityRecipientId).toBeNull();
  });
});
