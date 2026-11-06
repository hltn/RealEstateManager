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
  const service = new ReminderScannerService(
    { bulkWrite: jest.fn() } as never,
    statusModel as never,
    customers as never,
    settings as never,
  );
  return { service, statusModel, customers, rows };
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
});
