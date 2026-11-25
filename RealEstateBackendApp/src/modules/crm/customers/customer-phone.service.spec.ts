import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmAuditAction } from '../audit-logs/crm-audit.constants';
import { RATE_LIMITS } from '../common/security/crm-rate-limit.service';
import { CustomerPhoneService } from './customer-phone.service';
import { PhoneViewPurpose } from './customer.constants';

// Transaction giả: chạy `work` đúng một lần với session giả, lỗi ném lại nguyên vẹn như bản thật.
const SESSION = { id: 'tx-session' };
jest.mock('../../../shared/database/with-transaction.util', () => ({
  withTransaction: jest.fn(
    (_connection: unknown, work: (s: unknown) => unknown) => work(SESSION),
  ),
}));

const jwt = { sub: 'u1' } as unknown as JwtPayload;
const customerId = new Types.ObjectId().toHexString();
const SCOPE = { scope: 'giả' };

describe('CustomerPhoneService.view (FR-04)', () => {
  /** Ghi lại thứ tự gọi để kiểm "phạm vi -> NOT_SET -> rate-limit -> audit". */
  const build = (found: { phone: string | null } | null) => {
    const order: string[] = [];
    const findOne = jest.fn().mockImplementation(() => {
      order.push('findOne');
      return Promise.resolve(found);
    });
    const consume = jest.fn().mockImplementation(() => {
      order.push('rateLimit');
      return Promise.resolve();
    });
    const record = jest.fn().mockImplementation(() => {
      order.push('audit');
      return Promise.resolve();
    });
    const trackPhoneView = jest.fn().mockResolvedValue(undefined);
    const service = new CustomerPhoneService(
      {} as never,
      { findOne } as never,
      { resolve: jest.fn().mockResolvedValue({ scope: SCOPE }) } as never,
      { consume } as never,
      { trackPhoneView } as never,
      { record } as never,
      {
        get: jest.fn().mockResolvedValue({ phoneViewAlertPerHour: 200 }),
      } as never,
    );
    return { service, order, findOne, consume, record, trackPhoneView };
  };
  const dto = { purpose: PhoneViewPurpose.CALL };

  it('FR-04: khách có SĐT => trả số, ghi PHONE_VIEWED (kèm mục đích, không kèm số) và cảnh báo xem dồn dập', async () => {
    const h = build({ phone: '+84912345678' });
    const res = await h.service.view(jwt, customerId, dto);
    expect(res.phone).toBe('+84912345678');
    expect(h.findOne).toHaveBeenCalledWith(SCOPE, customerId, {
      projection: { phone: 1 },
    });
    expect(h.consume).toHaveBeenCalledWith('u1', 'PHONE_VIEW');
    const [entry, session] = h.record.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(entry).toMatchObject({
      action: CrmAuditAction.PHONE_VIEWED,
      reason: PhoneViewPurpose.CALL,
      customerId,
    });
    expect(JSON.stringify(entry)).not.toContain('+84912345678');
    expect(session).toBe(SESSION);
    expect(h.trackPhoneView).toHaveBeenCalledWith('u1', 200);
  });

  it('FR-04: thứ tự kiểm phạm vi -> rate-limit -> audit', async () => {
    const h = build({ phone: '+84912345678' });
    await h.service.view(jwt, customerId, dto);
    expect(h.order).toEqual(['findOne', 'rateLimit', 'audit']);
  });

  it.each([[null], ['']])(
    'FR-04: phone %j => 409 CUSTOMER_PHONE_NOT_SET, KHÔNG consume rate-limit, KHÔNG ghi PHONE_VIEWED, không cảnh báo',
    async (phone) => {
      const h = build({ phone });
      const error = await h.service
        .view(jwt, customerId, dto)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessException);
      const exception = error as BusinessException;
      expect(exception.getStatus()).toBe(409);
      expect(exception.getResponse()).toMatchObject({
        errorCode: 'CUSTOMER_PHONE_NOT_SET',
      });
      expect(h.consume).not.toHaveBeenCalled();
      expect(h.record).not.toHaveBeenCalled();
      expect(h.trackPhoneView).not.toHaveBeenCalled();
    },
  );

  it('FR-04: khách ngoài phạm vi/không tồn tại => 404 CUSTOMER_NOT_FOUND (không lộ NOT_SET), không rate-limit/audit', async () => {
    const h = build(null);
    const error = await h.service
      .view(jwt, customerId, dto)
      .catch((e: unknown) => e);
    expect((error as BusinessException).getStatus()).toBe(404);
    expect((error as BusinessException).getResponse()).toMatchObject({
      errorCode: ErrorCode.CUSTOMER_NOT_FOUND,
    });
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('FR-04: vượt rate-limit => ném lỗi của rate-limit, chưa ghi audit và không trả số', async () => {
    const h = build({ phone: '+84912345678' });
    const limited = new Error('RATE_LIMITED');
    h.consume.mockRejectedValueOnce(limited);
    await expect(h.service.view(jwt, customerId, dto)).rejects.toBe(limited);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('FR-04: ghi audit thất bại => không trả số, không cảnh báo', async () => {
    const h = build({ phone: '+84912345678' });
    const failure = new Error('audit down');
    h.record.mockRejectedValueOnce(failure);
    await expect(h.service.view(jwt, customerId, dto)).rejects.toBe(failure);
    expect(h.trackPhoneView).not.toHaveBeenCalled();
  });
});

describe('FR-03/FR-20: phone-lookups đã bị gỡ hẳn', () => {
  it('FR-03: CustomerPhoneService không còn lookup/describeExisting, vẫn còn view', () => {
    const proto = CustomerPhoneService.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(proto.lookup).toBeUndefined();
    expect(proto.describeExisting).toBeUndefined();
    expect(typeof proto.view).toBe('function');
  });

  it('FR-03: không còn rate-limit PHONE_LOOKUP, vẫn còn PHONE_VIEW', () => {
    expect(Object.keys(RATE_LIMITS)).not.toContain('PHONE_LOOKUP');
    expect(Object.keys(RATE_LIMITS)).toContain('PHONE_VIEW');
  });

  it('FR-04: ErrorCode có CUSTOMER_PHONE_NOT_SET; không còn CUSTOMER_PHONE_DUPLICATED', () => {
    expect(ErrorCode.CUSTOMER_PHONE_NOT_SET).toBe('CUSTOMER_PHONE_NOT_SET');
    expect(Object.values(ErrorCode)).not.toContain('CUSTOMER_PHONE_DUPLICATED');
  });

  it('FR-20: enum audit PHONE_LOOKUP vẫn còn để đọc log cũ', () => {
    expect(CrmAuditAction.PHONE_LOOKUP).toBe('PHONE_LOOKUP');
  });
});
