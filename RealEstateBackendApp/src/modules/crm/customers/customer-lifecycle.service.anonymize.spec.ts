import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { CrmAuditAction } from '../audit-logs/crm-audit.constants';
import { CustomerLifecycleService } from './customer-lifecycle.service';
import { ANONYMIZED_NAME } from './customer.constants';

// Transaction giả: chạy `work` đúng một lần với session giả, lỗi ném lại nguyên vẹn như bản thật.
const SESSION = { id: 'tx-session' };
jest.mock('../../../shared/database/with-transaction.util', () => ({
  withTransaction: jest.fn(
    (_connection: unknown, work: (s: unknown) => unknown) => work(SESSION),
  ),
}));

const jwt = { sub: 'admin1' } as unknown as JwtPayload;
const customerId = new Types.ObjectId();
const adminId = new Types.ObjectId();
const SCOPE = { scope: 'giả' };
const dto = {
  customerId: customerId.toHexString(),
  reason: 'Khách yêu cầu xóa dữ liệu',
  confirm: true,
};

describe('CustomerLifecycleService.anonymize (FR-06)', () => {
  const build = (
    found: Record<string, unknown> | null = {
      _id: customerId,
      anonymizedAt: null,
      purgingAt: null,
      deletedAt: null,
    },
    updateResult: unknown = { _id: customerId },
  ) => {
    const findOne = jest.fn().mockResolvedValue(found);
    const updateOne = jest.fn().mockResolvedValue(updateResult);
    const record = jest.fn().mockResolvedValue(undefined);
    const auditUpdateMany = jest.fn().mockResolvedValue({});
    const connection = {
      collection: jest.fn().mockReturnValue({ updateMany: auditUpdateMany }),
    };
    const careData = { anonymize: jest.fn().mockResolvedValue(undefined) };
    const personaData = { anonymize: jest.fn().mockResolvedValue(undefined) };
    const schedulingData = {
      anonymize: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerLifecycleService(
      connection as never,
      { findOne, updateOne } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ scope: SCOPE, actor: { userId: adminId } }),
      } as never,
      { record } as never,
      {} as never,
      careData as never,
      personaData as never,
      schedulingData as never,
      {} as never,
    );
    return { service, findOne, updateOne, record, careData };
  };

  /** Lấy tham số bộ lọc ghi và update của lần `repo.updateOne`. */
  const updateArgs = (updateOne: jest.Mock) => {
    const [scope, id, extraFilter, update, options] = updateOne.mock
      .calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
      { $set: Record<string, unknown>; $inc: Record<string, unknown> },
      Record<string, unknown>,
    ];
    return { scope, id, extraFilter, update, options };
  };

  it('FR-06: đặt phone = null (không còn số giả anonymized:<id>) và searchText = "", đã xóa PII khác', async () => {
    const h = build();
    await h.service.anonymize(jwt, dto);
    const { update } = updateArgs(h.updateOne);
    expect(update.$set.phone).toBeNull();
    expect(update.$set.searchText).toBe('');
    expect(update.$set.fullName).toBe(ANONYMIZED_NAME);
    expect(update.$set.email).toBeNull();
    expect(update.$set.hasNationalId).toBe(false);
    expect(JSON.stringify(update)).not.toContain('anonymized:');
  });

  it('FR-06/FR-07: GIỮ customerCode — không nằm trong $set/$unset của lần ghi', async () => {
    const h = build();
    await h.service.anonymize(jwt, dto);
    const { update } = updateArgs(h.updateOne);
    expect(Object.keys(update.$set)).not.toContain('customerCode');
    expect(Object.keys(update)).not.toContain('$unset');
    expect(JSON.stringify(update)).not.toContain('customerCode');
  });

  it('FR-06: ghi trong phạm vi + session, chặn khi đang xóa vĩnh viễn (purgingAt null), tính cả khách đã xóa mềm', async () => {
    const h = build();
    await h.service.anonymize(jwt, dto);
    const { scope, id, extraFilter, options } = updateArgs(h.updateOne);
    expect(scope).toBe(SCOPE);
    expect(String(id)).toBe(customerId.toHexString());
    expect(extraFilter).toEqual({ purgingAt: null });
    expect(options).toEqual({ session: SESSION, deleted: 'any' });
  });

  it('FR-06: ghi audit CUSTOMER_ANONYMIZED cùng transaction và dọn dữ liệu chăm sóc', async () => {
    const h = build();
    const res = await h.service.anonymize(jwt, dto);
    const [entry, session] = h.record.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(entry).toMatchObject({
      action: CrmAuditAction.CUSTOMER_ANONYMIZED,
      reason: dto.reason,
    });
    expect(session).toBe(SESSION);
    expect(h.careData.anonymize).toHaveBeenCalledTimes(1);
    expect(res.customerId).toBe(dto.customerId);
    expect(Number.isNaN(Date.parse(res.anonymizedAt))).toBe(false);
  });

  it('FR-06: khách đã ẩn danh => 409 CUSTOMER_ANONYMIZED, không ghi gì', async () => {
    const h = build({ _id: customerId, anonymizedAt: new Date() });
    const error = await h.service.anonymize(jwt, dto).catch((e: unknown) => e);
    expect((error as BusinessException).getStatus()).toBe(409);
    expect(h.updateOne).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('FR-06: khách không tồn tại/ngoài phạm vi => 404, không ghi gì', async () => {
    const h = build(null);
    const error = await h.service.anonymize(jwt, dto).catch((e: unknown) => e);
    expect((error as BusinessException).getStatus()).toBe(404);
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it('FR-06: purgingAt có giá trị (hoặc đua với xóa vĩnh viễn khiến updateOne không khớp) => 409, không ghi audit', async () => {
    const racing = build(undefined, null);
    const raced = await racing.service
      .anonymize(jwt, dto)
      .catch((e: unknown) => e);
    expect((raced as BusinessException).getStatus()).toBe(409);
    expect(racing.record).not.toHaveBeenCalled();

    const purging = build({ _id: customerId, purgingAt: new Date() });
    const blocked = await purging.service
      .anonymize(jwt, dto)
      .catch((e: unknown) => e);
    expect((blocked as BusinessException).getStatus()).toBe(409);
    expect(purging.updateOne).not.toHaveBeenCalled();
  });
});
