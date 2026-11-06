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
        restrictToActorScope: true,
      });
      expect(call[3]).toBe(session);
    }
    expect(careTeam.applyInSession.mock.calls.map((c) => c[1])).toEqual([
      CUSTOMER_A,
      CUSTOMER_B,
    ]);
  });

  it('đổi phụ trách chính hàng loạt (primaryUserId) cũng đi với origin BULK_ADD', async () => {
    const { service, careTeam } = build();
    await run(service, { primaryUserId: PRIMARY });
    expect(careTeam.applyInSession.mock.calls[0][2].origin).toBe('BULK_ADD');
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
