import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { CrmAuditLog } from '../audit-logs/schemas/crm-audit-log.schema';
import { ListGroup } from '../catalogs/catalog.enums';
import { Area } from '../catalogs/schemas/area.schema';
import { CustomerStatus } from '../catalogs/schemas/customer-status.schema';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CustomerAccessService } from './access/customer-access.service';
import { CustomerListService } from './customer-list.service';
import { CustomerRefsService } from './customer-refs.service';
import { CustomersRepository } from './customers.repository';

const jwt = { sub: 'user-1' } as JwtPayload;
const oid = () => new Types.ObjectId();

const query = <T>(result: T) => {
  const q: Record<string, jest.Mock> = {};
  for (const step of ['select', 'lean']) q[step] = jest.fn().mockReturnValue(q);
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

const statuses = [
  { _id: oid(), code: 'NOT_CONTACTED', listGroup: ListGroup.NOT_CONTACTED },
  { _id: oid(), code: 'INTERESTED', listGroup: ListGroup.INTERESTED },
  { _id: oid(), code: 'NET', listGroup: ListGroup.NET },
  { _id: oid(), code: 'DROPPED', listGroup: ListGroup.DROPPED },
];
const droppedExtra = {
  _id: oid(),
  code: 'DROPPED_PRICE',
  listGroup: ListGroup.DROPPED,
};

const build = async () => {
  const allStatuses = [...statuses, droppedExtra];
  const statusModel = {
    find: jest.fn((filter: Record<string, any>) => {
      if (filter.listGroup) {
        return query(
          allStatuses.filter((s) => s.listGroup === filter.listGroup),
        );
      }
      return query(allStatuses);
    }),
  };
  const areaModel = { find: jest.fn(() => query([])) };
  const repo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([]),
  };
  const refs = {
    resolve: jest.fn().mockResolvedValue(new Map()),
    resolveByCodes: jest.fn().mockResolvedValue([]),
    resolveByIds: jest.fn().mockResolvedValue([]),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      CustomerListService,
      { provide: getModelToken(CustomerStatus.name), useValue: statusModel },
      { provide: getModelToken(Area.name), useValue: areaModel },
      {
        provide: getModelToken(CrmAuditLog.name),
        useValue: { find: jest.fn() },
      },
      { provide: CustomersRepository, useValue: repo },
      {
        provide: CustomerAccessService,
        useValue: { resolve: jest.fn().mockResolvedValue({ scope: {} }) },
      },
      { provide: CustomerRefsService, useValue: refs },
      { provide: CrmRateLimitService, useValue: {} },
      { provide: CrmAbuseMonitorService, useValue: {} },
    ],
  }).compile();
  return {
    service: moduleRef.get(CustomerListService),
    statusModel,
    areaModel,
    repo,
    refs,
  };
};

/** Điều kiện lọc được truyền vào repository (gồm trong `$and`). */
const filterOf = (repoCall: jest.Mock): Array<Record<string, unknown>> => {
  const filter = repoCall.mock.calls[0][1] as { $and?: unknown[] };
  return (filter.$and ?? []) as Array<Record<string, unknown>>;
};

const idOf = (code: string): Types.ObjectId =>
  [...statuses, droppedExtra].find((status) => status.code === code)!._id;

/** Điều kiện tình trạng: theo `statusCode`, dự phòng `statusId` cho khách chưa backfill `statusCode` (Q3). */
const byStatus = (codes: string[]) => ({
  $or: [
    { statusCode: { $in: codes } },
    { statusCode: null, statusId: { $in: codes.map(idOf) } },
  ],
});

describe('CustomerListService: lọc theo code (FR-40)', () => {
  it('FR-40: statusCodes lọc theo statusCode, kèm nhánh dự phòng statusId cho khách chưa backfill', async () => {
    const { service, repo } = await build();
    await service.list(jwt, { statusCodes: ['NET', 'DROPPED'] });
    expect(filterOf(repo.find)).toEqual([byStatus(['NET', 'DROPPED'])]);
  });

  it('FR-40: sourceCodes lọc theo sourceCode kèm nhánh sourceId (khách chưa backfill), id lấy từ MỘT lần resolveByCodes', async () => {
    const { service, repo, refs } = await build();
    const [fb, zalo] = [oid(), oid()];
    refs.resolveByCodes.mockResolvedValue([
      { id: fb, code: 'FACEBOOK_ADS', label: 'FB' },
      { id: zalo, code: 'ZALO', label: 'Zalo' },
    ]);
    await service.list(jwt, { sourceCodes: ['FACEBOOK_ADS', 'ZALO'] });
    expect(filterOf(repo.find)).toEqual([
      {
        $or: [
          { sourceCode: { $in: ['FACEBOOK_ADS', 'ZALO'] } },
          { sourceCode: null, sourceId: { $in: [fb, zalo] } },
        ],
      },
    ]);
    expect(refs.resolveByCodes).toHaveBeenCalledTimes(1);
  });

  it('FR-40: projectCodes (chuẩn hóa HOA) lọc mảng interestedProjectCodes kèm nhánh id cho khách chưa backfill mã', async () => {
    const { service, repo, refs } = await build();
    const vhop = oid();
    refs.resolveByCodes.mockResolvedValue([
      { id: vhop, code: 'VHOP', label: 'VHOP' },
    ]);
    await service.list(jwt, { projectCodes: ['vhop', 'Qterra'] });
    expect(refs.resolveByCodes).toHaveBeenCalledWith('project', [
      'VHOP',
      'QTERRA',
    ]);
    expect(filterOf(repo.find)).toEqual([
      {
        $or: [
          { interestedProjectCodes: { $in: ['VHOP', 'QTERRA'] } },
          {
            interestedProjectCodes: { $in: [null, []] },
            interestedProjectIds: { $in: [vhop] },
          },
        ],
      },
    ]);
  });

  it('FR-40: mã nguồn/dự án không tồn tại: nhánh id rỗng nên chỉ còn nhánh mã (không khớp ai, không lỗi)', async () => {
    const { service, repo } = await build();
    await service.list(jwt, {
      sourceCodes: ['KHONG_CO'],
      projectCodes: ['khong_co'],
    });
    expect(filterOf(repo.find)).toEqual([
      { sourceCode: { $in: ['KHONG_CO'] } },
      { interestedProjectCodes: { $in: ['KHONG_CO'] } },
    ]);
  });

  it('FR-40: areaCodes mở rộng sang khu vực con: nhánh mã dùng areaCode, nhánh id dùng areaId của cả cây', async () => {
    const { service, repo, areaModel, refs } = await build();
    const [root, child, noCode] = [oid(), oid(), oid()];
    refs.resolveByCodes.mockResolvedValue([
      { id: root, code: 'HA_NOI', label: 'Hà Nội' },
    ]);
    areaModel.find.mockReturnValue(
      query([
        { _id: root, code: 'HA_NOI' },
        { _id: child, code: 'CAU_GIAY' },
        { _id: noCode }, // khu vực con chưa có code: không vào nhánh mã, vẫn vào nhánh id
      ]),
    );
    await service.list(jwt, { areaCodes: ['HA_NOI'] });
    expect(areaModel.find).toHaveBeenCalledWith({
      $or: [{ _id: { $in: [root] } }, { ancestorIds: { $in: [root] } }],
    });
    expect(filterOf(repo.find)).toEqual([
      {
        $or: [
          { areaCode: { $in: ['HA_NOI', 'CAU_GIAY'] } },
          { areaCode: null, areaId: { $in: [root, child, noCode] } },
        ],
      },
    ]);
  });

  it('FR-40: areaCodes không tồn tại thì không khớp khách nào (NO_MATCH), không lỗi', async () => {
    const { service, repo } = await build();
    await service.list(jwt, { areaCodes: ['KHONG_CO'] });
    expect(filterOf(repo.find)).toEqual([{ areaCode: { $in: [] } }]);
  });

  it('FR-40: tab listGroup dùng mã + id của nhóm; giao với statusCodes', async () => {
    const { service, repo } = await build();
    await service.list(jwt, { listGroup: ListGroup.DROPPED });
    expect(filterOf(repo.find)).toEqual([
      byStatus(['DROPPED', 'DROPPED_PRICE']),
    ]);

    repo.find.mockClear();
    await service.list(jwt, {
      listGroup: ListGroup.DROPPED,
      statusCodes: ['DROPPED_PRICE', 'NET'],
    });
    expect(filterOf(repo.find)).toEqual([byStatus(['DROPPED_PRICE'])]);

    repo.find.mockClear();
    await service.list(jwt, {
      listGroup: ListGroup.DROPPED,
      statusCodes: ['NET'],
    });
    expect(filterOf(repo.find)).toEqual([{ _id: { $in: [] } }]);
  });

  it('FR-40: tab ALL không tạo điều kiện tình trạng', async () => {
    const { service, repo } = await build();
    await service.list(jwt, { listGroup: 'ALL' });
    expect(repo.find.mock.calls[0][1]).toEqual({});
  });

  it('FR-40: đường cũ …Ids vẫn lọc theo id (PWA cũ), không gọi dịch id/code', async () => {
    const { service, repo, refs } = await build();
    const statusId = oid().toHexString();
    const sourceId = oid().toHexString();
    await service.list(jwt, { statusIds: [statusId], sourceIds: [sourceId] });
    expect(filterOf(repo.find)).toEqual([
      { statusId: { $in: [new Types.ObjectId(statusId)] } },
      { sourceId: { $in: [new Types.ObjectId(sourceId)] } },
    ]);
    expect(refs.resolveByCodes).not.toHaveBeenCalled();
    expect(refs.resolveByIds).not.toHaveBeenCalled();
  });

  it('FR-40: có cả id và code: cùng tập thì dùng mã; lệch tập thì 400 VALIDATION_FAILED', async () => {
    const { service, repo, refs } = await build();
    const id = oid();
    refs.resolveByCodes.mockResolvedValue([{ id, code: 'NET', label: 'Net' }]);
    refs.resolveByIds.mockResolvedValue([{ id, code: 'NET', label: 'Net' }]);
    await service.list(jwt, {
      statusIds: [id.toHexString()],
      statusCodes: ['NET'],
    });
    expect(filterOf(repo.find)).toEqual([byStatus(['NET'])]);

    refs.resolveByIds.mockResolvedValue([
      { id: oid(), code: 'DROPPED', label: 'Bỏ' },
    ]);
    await expect(
      service.list(jwt, {
        statusIds: [id.toHexString()],
        statusCodes: ['NET'],
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});

describe('CustomerListService.counts: $group theo statusCode (FR-40)', () => {
  it('FR-40: gom theo statusCode, trả byStatus[].statusCode cùng statusId; tổng byStatus = ALL', async () => {
    const { service, repo } = await build();
    const [notContacted, interested, net, dropped] = statuses;
    repo.aggregate.mockResolvedValue([
      { _id: { code: 'NOT_CONTACTED', id: notContacted._id }, count: 3 },
      { _id: { code: 'INTERESTED', id: interested._id }, count: 2 },
      { _id: { code: 'NET', id: net._id }, count: 4 },
      { _id: { code: 'DROPPED', id: dropped._id }, count: 1 },
    ]);
    const counts = await service.counts(jwt, {});
    expect(repo.aggregate.mock.calls[0][2]).toEqual([
      {
        $group: {
          _id: { code: '$statusCode', id: '$statusId' },
          count: { $sum: 1 },
        },
      },
    ]);
    expect(counts).toMatchObject({
      ALL: 10,
      NOT_CONTACTED: 3,
      INTERESTED: 2,
      NET: 4,
      DROPPED: 1,
    });
    expect(counts.byStatus).toEqual([
      {
        statusId: String(notContacted._id),
        statusCode: 'NOT_CONTACTED',
        count: 3,
      },
      { statusId: String(interested._id), statusCode: 'INTERESTED', count: 2 },
      { statusId: String(net._id), statusCode: 'NET', count: 4 },
      { statusId: String(dropped._id), statusCode: 'DROPPED', count: 1 },
    ]);
    const sum = counts.byStatus.reduce((acc, row) => acc + row.count, 0);
    expect(sum).toBe(counts.ALL);
  });

  it('FR-40: khách chưa có statusCode (kiểu v1.0.3) được đếm bằng cách dịch id sang mã, gộp vào cùng tình trạng, không thiếu tổng', async () => {
    const { service, repo } = await build();
    const net = statuses[2];
    repo.aggregate.mockResolvedValue([
      { _id: { code: 'NET', id: net._id }, count: 4 },
      { _id: { id: net._id }, count: 2 },
    ]);
    const counts = await service.counts(jwt, {});
    expect(counts.ALL).toBe(6);
    expect(counts.NET).toBe(6);
    expect(counts.byStatus).toEqual([
      { statusId: String(net._id), statusCode: 'NET', count: 6 },
    ]);
  });

  it('FR-40: tình trạng bị xóa cứng (id mồ côi, không có mã) vẫn tính vào ALL nhưng không có dòng byStatus', async () => {
    const { service, repo } = await build();
    repo.aggregate.mockResolvedValue([{ _id: { id: oid() }, count: 5 }]);
    const counts = await service.counts(jwt, {});
    expect(counts.ALL).toBe(5);
    expect(counts.byStatus).toEqual([]);
  });

  it('FR-40: list-counts nhận bộ lọc mã như danh sách', async () => {
    const { service, repo } = await build();
    await service.counts(jwt, { statusCodes: ['NET'], projectCodes: ['vhop'] });
    expect(repo.aggregate.mock.calls[0][1]).toEqual({
      $and: [byStatus(['NET']), { interestedProjectCodes: { $in: ['VHOP'] } }],
    });
  });
});
