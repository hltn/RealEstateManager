import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmAuditLog } from '../audit-logs/schemas/crm-audit-log.schema';
import { Area } from '../catalogs/schemas/area.schema';
import { CustomerStatus } from '../catalogs/schemas/customer-status.schema';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CustomerAccessService } from './access/customer-access.service';
import { CustomerListService } from './customer-list.service';
import { CustomerRefsService } from './customer-refs.service';
import { CustomersRepository } from './customers.repository';

const jwt = { sub: 'user-1' } as JwtPayload;
const emptyRefs = () => ({
  statuses: new Map(),
  sources: new Map(),
  areas: new Map(),
  projects: new Map(),
  contactResults: new Map(),
  tags: new Map(),
  users: new Map(),
  codes: {
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
  },
});

describe('FR-09: CustomerListService tìm theo mã khách', () => {
  let service: CustomerListService;
  let repo: { find: jest.Mock; count: jest.Mock };
  let rateLimit: { consumeDeduped: jest.Mock };
  let abuse: { trackPhoneSearch: jest.Mock };
  let access: { resolve: jest.Mock };
  const staffScope = { ownerIds: [new Types.ObjectId()] };

  beforeEach(async () => {
    access = {
      resolve: jest.fn().mockResolvedValue({
        scope: staffScope,
        actor: { role: UserRole.STAFF },
      }),
    };
    repo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    rateLimit = { consumeDeduped: jest.fn().mockResolvedValue(undefined) };
    abuse = { trackPhoneSearch: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerListService,
        { provide: getModelToken(CustomerStatus.name), useValue: {} },
        { provide: getModelToken(Area.name), useValue: {} },
        {
          provide: getModelToken(CrmAuditLog.name),
          useValue: { find: jest.fn() },
        },
        { provide: CustomersRepository, useValue: repo },
        { provide: CustomerAccessService, useValue: access },
        {
          provide: CustomerRefsService,
          useValue: { resolve: jest.fn().mockResolvedValue(emptyRefs()) },
        },
        { provide: CrmRateLimitService, useValue: rateLimit },
        { provide: CrmAbuseMonitorService, useValue: abuse },
      ],
    }).compile();
    service = moduleRef.get(CustomerListService);
  });

  it('q là mã: truy vấn customerCode có $type string, vẫn qua phạm vi của người gọi, không theo dõi dò số', async () => {
    await service.list(jwt, { q: 'kh-12' });

    const [scope, filter] = repo.find.mock.calls[0] as [unknown, unknown];
    expect(scope).toBe(staffScope);
    const json = JSON.stringify(filter);
    expect(json).toContain(
      '"customerCode":{"$type":"string","$eq":"KH-000012"}',
    );
    expect(json).not.toContain('searchText');
    expect(abuse.trackPhoneSearch).not.toHaveBeenCalled();
  });

  it('q là mã vẫn tốn lượt rate limit tìm kiếm (không mở cửa dò mã không giới hạn)', async () => {
    await service.list(jwt, { q: 'KH000123' });
    expect(rateLimit.consumeDeduped).toHaveBeenCalledWith(
      'user-1',
      'CUSTOMER_SEARCH',
      'code:000123',
    );
  });

  it('Staff tìm mã khách nằm ngoài phạm vi: bộ lọc mã không thay thế phạm vi (repo nhận đúng scope của Staff)', async () => {
    await service.list(jwt, { q: 'KH-000999' });
    await service.listDeleted(jwt, { q: 'KH-000999' });
    for (const call of repo.find.mock.calls as Array<[unknown]>) {
      expect(call[0]).toBe(staffScope);
    }
  });

  it('danh sách đã xóa cũng tìm được theo mã', async () => {
    await service.listDeleted(jwt, { q: 'kh123' });
    const [, filter] = repo.find.mock.calls[0] as [unknown, unknown];
    expect(JSON.stringify(filter)).toContain('"$eq":"KH-000123"');
    expect(abuse.trackPhoneSearch).not.toHaveBeenCalled();
  });

  it('list-counts dùng cùng điều kiện mã với danh sách', async () => {
    const aggregate = jest.fn().mockResolvedValue([]);
    (repo as unknown as { aggregate: jest.Mock }).aggregate = aggregate;
    (service as unknown as { statusModel: { find: jest.Mock } }).statusModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
      }),
    };
    await service.counts(jwt, { q: 'kh-12' });
    expect(JSON.stringify(aggregate.mock.calls[0])).toContain('KH-000012');
  });

  it('từ khóa toàn số vẫn là SĐT: theo dõi dò số, dùng searchText, không có điều kiện customerCode', async () => {
    await service.list(jwt, { q: '0912345' });

    expect(abuse.trackPhoneSearch).toHaveBeenCalledWith('user-1', '0912345');
    const [, filter] = repo.find.mock.calls[0] as [unknown, unknown];
    const json = JSON.stringify(filter);
    expect(json).toContain('searchText');
    expect(json).not.toContain('customerCode');
    expect(rateLimit.consumeDeduped).toHaveBeenCalledWith(
      'user-1',
      'CUSTOMER_SEARCH',
      'phone:0912345',
    );
  });

  it('số thuần 000123 là SĐT (dưới ngưỡng 6 số chỉ khớp đuôi), không bao giờ là mã', async () => {
    await service.list(jwt, { q: '000123' });
    expect(abuse.trackPhoneSearch).toHaveBeenCalledWith('user-1', '000123');
    const [, filter] = repo.find.mock.calls[0] as [unknown, unknown];
    expect(JSON.stringify(filter)).not.toContain('customerCode');
  });

  it('tên có chữ kh (khanh) tìm theo tên, không theo dõi dò số, không điều kiện mã', async () => {
    await service.list(jwt, { q: 'Khánh' });
    expect(abuse.trackPhoneSearch).not.toHaveBeenCalled();
    const [, filter] = repo.find.mock.calls[0] as [unknown, unknown];
    expect(JSON.stringify(filter)).not.toContain('customerCode');
  });

  it('không có từ khóa: không điều kiện tìm kiếm nào, không tốn rate limit', async () => {
    await service.list(jwt, {});
    expect(rateLimit.consumeDeduped).not.toHaveBeenCalled();
    const [, filter] = repo.find.mock.calls[0] as [unknown, unknown];
    expect(filter).toEqual({});
  });
});
