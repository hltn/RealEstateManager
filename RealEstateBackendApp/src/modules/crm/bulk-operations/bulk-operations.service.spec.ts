import { Types } from 'mongoose';
import { BulkOperationsService } from './bulk-operations.service';
import { BulkOperationType } from './dtos/bulk-operation.dto';

const ACTOR = new Types.ObjectId();
const CUSTOMER_A = '65a000000000000000000001';
const CUSTOMER_B = '65a000000000000000000002';
const MEMBER = '65a0000000000000000000aa';
const PRIMARY = '65a0000000000000000000bb';

const build = (role = 'ADMIN') => {
  const session = { id: 'session' };
  // `withTransaction` dùng `connection.transaction(work)`: chạy `work` với phiên giả, không cần DB.
  const connection = {
    transaction: jest.fn((work: (s: unknown) => Promise<unknown>) =>
      work(session),
    ),
  };
  const access = {
    resolve: jest.fn().mockResolvedValue({
      actor: { userId: ACTOR, role },
    }),
  };
  const careTeam = { applyInSession: jest.fn().mockResolvedValue(undefined) };
  const rateLimit = { consume: jest.fn().mockResolvedValue(undefined) };
  const service = new BulkOperationsService(
    connection as never,
    access as never,
    {} as never,
    careTeam as never,
    {} as never,
    {} as never,
    rateLimit as never,
  );
  return { service, careTeam, session };
};

describe('BulkOperationsService.ASSIGN (T-34)', () => {
  const run = (
    service: BulkOperationsService,
    payload: Record<string, unknown>,
  ) =>
    service.run(
      { sub: String(ACTOR), email: 'a@test.vn', role: 'ADMIN' },
      {
        type: BulkOperationType.ASSIGN,
        customerIds: [CUSTOMER_A, CUSTOMER_B],
        payload,
      },
    );

  it('mỗi khách gọi applyInSession với origin = BULK_ADD (nguồn của giới hạn 3 push/đợt) cùng phiên transaction', async () => {
    const { service, careTeam, session } = build();
    const result = await run(service, { memberIds: [MEMBER] });

    expect(result.succeeded).toEqual([CUSTOMER_A, CUSTOMER_B]);
    expect(careTeam.applyInSession).toHaveBeenCalledTimes(2);
    for (const call of careTeam.applyInSession.mock.calls) {
      expect(call[2]).toMatchObject({
        origin: 'BULK_ADD',
      });
      expect(call[3]).toBe(session);
    }
    expect(careTeam.applyInSession.mock.calls.map((c) => c[1])).toEqual([
      CUSTOMER_A,
      CUSTOMER_B,
    ]);
  });

  it('FR-11: truyền primaryUserId bị từ chối 400 VALIDATION_FAILED cho cả lô, không khách nào bị đụng tới', async () => {
    const { service, careTeam } = build();
    await expect(
      run(service, { memberIds: [MEMBER], primaryUserId: PRIMARY }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
    await expect(
      run(service, { primaryUserId: PRIMARY }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
    expect(careTeam.applyInSession).not.toHaveBeenCalled();
  });

  it('FR-11: thiếu memberIds (rỗng hoặc không có) bị từ chối 400 VALIDATION_FAILED', async () => {
    const { service, careTeam } = build();
    await expect(run(service, {})).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
    await expect(run(service, { memberIds: [] })).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
    expect(careTeam.applyInSession).not.toHaveBeenCalled();
  });

  it('FR-11: kế hoạch từng khách chỉ thêm MEMBER (PRIMARY giữ nguyên, người đã có bị bỏ qua); khách careTeam rỗng báo PRIMARY_REQUIRED', async () => {
    const { service, careTeam } = build();
    await run(service, { memberIds: [MEMBER] });
    const { plan } = careTeam.applyInSession.mock.calls[0][2];
    const existing = new Types.ObjectId(PRIMARY);
    const now = new Date();
    const current = [
      { userId: existing, role: 'PRIMARY', addedBy: ACTOR, addedAt: now },
    ];

    const change = plan(current, now);
    expect(change.primaryChanged).toBe(false);
    expect(
      change.careTeam.map((m: { userId: Types.ObjectId; role: string }) => [
        String(m.userId),
        m.role,
      ]),
    ).toEqual([
      [PRIMARY, 'PRIMARY'],
      [MEMBER, 'MEMBER'],
    ]);
    // Người đã có trong nhóm thì bỏ qua (skipExisting), không lỗi.
    const again = plan(change.careTeam, now);
    expect(again.addedUserIds).toEqual([]);

    expect(() => plan([], now)).toThrow(
      expect.objectContaining({ errorCode: 'PRIMARY_REQUIRED' }),
    );
  });

  it('FR-11: Nhân viên không được ASSIGN hàng loạt', async () => {
    const { service, careTeam } = build('STAFF');
    await expect(run(service, { memberIds: [MEMBER] })).rejects.toMatchObject({
      status: 403,
    });
    expect(careTeam.applyInSession).not.toHaveBeenCalled();
  });

  it('một khách lỗi không làm khách khác mất origin: khách còn lại vẫn BULK_ADD', async () => {
    const { service, careTeam } = build();
    careTeam.applyInSession.mockRejectedValueOnce(new Error('lỗi'));
    const result = await run(service, { memberIds: [MEMBER] });
    expect(result.failed).toHaveLength(1);
    expect(result.succeeded).toEqual([CUSTOMER_B]);
    expect(careTeam.applyInSession.mock.calls[1][2].origin).toBe('BULK_ADD');
  });
});
