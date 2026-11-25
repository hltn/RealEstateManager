import { HttpStatus } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import { CrmAuditLog } from '../audit-logs/schemas/crm-audit-log.schema';
import { Area } from '../catalogs/schemas/area.schema';
import { CustomerStatus } from '../catalogs/schemas/customer-status.schema';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CustomerAccessService } from './access/customer-access.service';
import { CustomerRefsService } from './customer-refs.service';
import { CustomerListService } from './customer-list.service';
import { CustomersRepository } from './customers.repository';

const jwt = { sub: 'user-1' } as JwtPayload;

/** Redis giả đủ cho rate limit: `set NX` (dedupe) và `eval` (INCR + TTL) theo bộ nhớ. */
const createFakeRedis = () => {
  const keys = new Set<string>();
  const counters = new Map<string, number>();
  return {
    set: jest.fn((key: string) => {
      if (keys.has(key)) return Promise.resolve(null);
      keys.add(key);
      return Promise.resolve('OK');
    }),
    eval: jest.fn((_script: string, _n: number, key: string) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return Promise.resolve([count, 60_000]);
    }),
  };
};

describe('CustomerListService.listDeleted (FR-16)', () => {
  let service: CustomerListService;
  let access: { resolve: jest.Mock };
  let repo: { find: jest.Mock; count: jest.Mock };
  let abuse: { trackPhoneSearch: jest.Mock };

  beforeEach(async () => {
    access = { resolve: jest.fn().mockResolvedValue({ scope: {} }) };
    repo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    abuse = { trackPhoneSearch: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerListService,
        CrmRateLimitService,
        { provide: REDIS_CLIENT, useValue: createFakeRedis() },
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
          useValue: { resolve: jest.fn().mockResolvedValue(new Map()) },
        },
        { provide: CrmAbuseMonitorService, useValue: abuse },
      ],
    }).compile();
    service = moduleRef.get(CustomerListService);
  });

  it('FR-16: tìm SĐT từng phần ở danh sách đã xóa phải qua guardSearch (theo dõi dò số)', async () => {
    await service.listDeleted(jwt, { q: '0912345' });

    expect(abuse.trackPhoneSearch).toHaveBeenCalledWith('user-1', '0912345');
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it('FR-16: không có từ khóa thì không tốn lượt rate limit và không theo dõi dò số', async () => {
    await service.listDeleted(jwt, {});

    expect(abuse.trackPhoneSearch).not.toHaveBeenCalled();
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it('FR-16: guardSearch chạy ngay sau access.resolve, trước khi truy vấn dữ liệu', async () => {
    const order: string[] = [];
    access.resolve.mockImplementation(() => {
      order.push('resolve');
      return Promise.resolve({ scope: {} });
    });
    abuse.trackPhoneSearch.mockImplementation(() => {
      order.push('guard');
      return Promise.resolve();
    });
    repo.find.mockImplementation(() => {
      order.push('find');
      return Promise.resolve([]);
    });

    await service.listDeleted(jwt, { q: '0912345' });

    expect(order).toEqual(['resolve', 'guard', 'find']);
  });

  it('FR-16: lượt tìm thứ 31 trong phút trả 429 và không truy vấn dữ liệu', async () => {
    for (let i = 0; i < 30; i += 1) {
      await service.listDeleted(jwt, { q: `09${String(10000 + i)}` });
    }
    repo.find.mockClear();

    await expect(
      service.listDeleted(jwt, { q: '0999999' }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('FR-16: lỗi guardSearch (429) chặn trước khi chạm repository', async () => {
    access.resolve.mockResolvedValue({
      scope: { ownerIds: [new Types.ObjectId()] },
    });
    abuse.trackPhoneSearch.mockRejectedValue(new Error('blocked'));

    await expect(service.listDeleted(jwt, { q: '0912345' })).rejects.toThrow(
      'blocked',
    );
    expect(repo.find).not.toHaveBeenCalled();
  });
});
