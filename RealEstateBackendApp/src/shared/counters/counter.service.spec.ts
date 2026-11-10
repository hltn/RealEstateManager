import { ClientSession, Model } from 'mongoose';
import { Counter } from './counter.schema';
import { CounterService } from './counter.service';

/** Query giả của findOneAndUpdate: lean().exec() trả `result`. */
const fakeModel = (result: { seq: number } | null) => {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
  return { findOneAndUpdate };
};

const session = { id: 'sess' } as unknown as ClientSession;

describe('CounterService.next (T-01, FR-07)', () => {
  const build = (result: { seq: number } | null) => {
    const model = fakeModel(result);
    const service = new CounterService(model as unknown as Model<Counter>);
    return { model, service };
  };

  it('FR-07: cấp 1 mã -> first = last = seq sau khi tăng', async () => {
    const { service, model } = build({ seq: 5 });
    await expect(service.next('CUSTOMER_CODE', 1, session)).resolves.toEqual({
      first: 5,
      last: 5,
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('FR-07: cấp lô n mã -> khoảng [seq-n+1, seq], chỉ MỘT lần $inc n', async () => {
    const { service, model } = build({ seq: 30 });
    const range = await service.next('CUSTOMER_CODE', 10, session);
    expect(range).toEqual({ first: 21, last: 30 });
    expect(range.last - range.first + 1).toBe(10);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $inc: { seq: 10 },
    });
  });

  it('FR-07: counter vừa tạo (seq 0 -> n) cấp từ 1', async () => {
    const { service } = build({ seq: 3 });
    await expect(service.next('CUSTOMER_CODE', 3, session)).resolves.toEqual({
      first: 1,
      last: 3,
    });
  });

  it("FR-07: truyền đúng session, key, upsert và returnDocument:'after' (không dùng new)", async () => {
    const { service, model } = build({ seq: 1 });
    await service.next('CUSTOMER_CODE', 1, session);
    const [filter, , options] = model.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'CUSTOMER_CODE' });
    expect(options).toEqual({
      upsert: true,
      returnDocument: 'after',
      session,
    });
    expect(options).not.toHaveProperty('new');
    expect(options.session).toBe(session);
  });

  it.each([0, -2, 1.5, NaN])(
    'FR-07: count %p không hợp lệ ném RangeError, không ghi DB',
    async (count) => {
      const { service, model } = build({ seq: 1 });
      await expect(
        service.next('CUSTOMER_CODE', count, session),
      ).rejects.toThrow(RangeError);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('FR-07: DB không trả doc thì ném lỗi, không cấp khoảng sai', async () => {
    const { service } = build(null);
    await expect(service.next('CUSTOMER_CODE', 1, session)).rejects.toThrow(
      /CUSTOMER_CODE/,
    );
  });

  it('FR-07: lỗi từ DB được ném nguyên vẹn (transaction rollback)', async () => {
    const model = fakeModel(null);
    const boom = new Error('TransientTransactionError');
    model.findOneAndUpdate().lean().exec.mockRejectedValueOnce(boom);
    model.findOneAndUpdate.mockClear();
    const service = new CounterService(model as unknown as Model<Counter>);
    await expect(service.next('CUSTOMER_CODE', 1, session)).rejects.toBe(boom);
  });
});
