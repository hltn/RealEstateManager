import { Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmAuditSource } from '../audit-logs/crm-audit.constants';
import { ListGroup } from '../catalogs/catalog.enums';
import { CustomerStatusChangeService } from './customer-status-change.service';
import type { AccessContext } from './access/customer-access.service';

const oid = () => new Types.ObjectId();
const fromId = oid();
const toId = oid();
const statusRef = (id: Types.ObjectId, code: string, label: string) => ({
  id: String(id),
  code,
  label,
  listGroup: ListGroup.INTERESTED,
  color: null,
});

const build = () => {
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      statusId: fromId,
      lastUpdatedAt: new Date(),
      __v: 3,
    }),
    updateOne: jest.fn().mockResolvedValue(true),
  };
  const refs = {
    lockAndAssert: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue({
      statuses: new Map([
        [String(fromId), statusRef(fromId, 'INTERESTED', 'Có quan tâm')],
        [String(toId), statusRef(toId, 'NET', 'Khách net')],
      ]),
    }),
    resolveSingleInput: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomerStatusChangeService(
    {} as never,
    repo as never,
    {} as never,
    refs as never,
    audit as never,
  );
  return { service, repo, refs, audit };
};

const ctx = {
  scope: {},
  actor: { userId: oid() },
} as unknown as AccessContext;
const SOURCE: CrmAuditSource = 'WEB';

describe('CustomerStatusChangeService: ghi kép statusCode (FR-40)', () => {
  it('FR-40: applyChange $set cả statusId lẫn statusCode của tình trạng đích', async () => {
    const { service, repo } = build();
    await service.applyChange(
      ctx,
      String(oid()),
      toId,
      { version: 3 },
      SOURCE,
      {} as never,
    );
    const update = repo.updateOne.mock.calls[0][3] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.statusId).toEqual(toId);
    expect(update.$set.statusCode).toBe('NET');
  });

  it('FR-40: audit STATUS_CHANGED có fromCode/toCode cạnh from/to (nhãn)', async () => {
    const { service, audit } = build();
    await service.applyChange(
      ctx,
      String(oid()),
      toId,
      { version: 3 },
      SOURCE,
      {} as never,
    );
    const entry = audit.record.mock.calls[0][0] as {
      changes: Array<Record<string, any>>;
    };
    expect(entry.changes[0]).toMatchObject({
      field: 'status',
      from: { label: 'Có quan tâm' },
      to: { label: 'Khách net' },
      fromCode: 'INTERESTED',
      toCode: 'NET',
    });
  });

  it('FR-40: đặt lại đúng tình trạng hiện tại là no-op: không ghi, không audit', async () => {
    const { service, repo, audit } = build();
    await service.applyChange(
      ctx,
      String(oid()),
      fromId,
      { version: 3 },
      SOURCE,
      {} as never,
    );
    expect(repo.updateOne).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('FR-40: resolveTargetId chỉ có statusId thì dùng luôn, không tra DB (hành vi cũ giữ nguyên)', async () => {
    const { service, refs } = build();
    const id = oid();
    const result = await service.resolveTargetId(
      { statusId: String(id) },
      'statusCode',
    );
    expect(result).toEqual(id);
    expect(refs.resolveSingleInput).not.toHaveBeenCalled();
  });

  it('FR-40: resolveTargetId có statusCode thì dịch qua CustomerRefsService (không lọc hoạt động)', async () => {
    const { service, refs } = build();
    refs.resolveSingleInput.mockResolvedValue({
      provided: true,
      ref: { id: toId, code: 'NET', label: 'Khách net' },
    });
    expect(
      await service.resolveTargetId({ statusCode: 'NET' }, 'statusCode'),
    ).toEqual(toId);
    expect(refs.resolveSingleInput).toHaveBeenCalledWith(
      'status',
      { id: undefined, code: 'NET' },
      'statusCode',
      undefined,
      false,
    );
  });

  it('FR-40: resolveTargetId thiếu cả statusId lẫn statusCode thì 400', async () => {
    const { service, refs } = build();
    refs.resolveSingleInput.mockResolvedValue({ provided: false, ref: null });
    await expect(
      service.resolveTargetId({}, 'statusCode'),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('FR-40: lỗi lệch id/code từ CustomerRefsService được giữ nguyên (400)', async () => {
    const { service, refs } = build();
    const failure = new BusinessException(
      ErrorCode.VALIDATION_FAILED,
      'lệch',
      400,
    );
    refs.resolveSingleInput.mockRejectedValue(failure);
    await expect(
      service.resolveTargetId(
        { statusId: String(oid()), statusCode: 'NET' },
        'statusCode',
      ),
    ).rejects.toBe(failure);
  });
});
