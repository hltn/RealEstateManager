import { Logger } from '@nestjs/common';
import { IdempotencyService } from '../services/idempotency.service';
import { runIdempotent } from './idempotent-request.util';

function createIdempotency() {
  return {
    get: jest.fn().mockResolvedValue(null),
    tryMarkInFlight: jest.fn().mockResolvedValue(true),
    set: jest.fn().mockResolvedValue(undefined),
    clearInFlight: jest.fn().mockResolvedValue(undefined),
  };
}

const run = <T>(
  idempotency: ReturnType<typeof createIdempotency>,
  key: string | undefined,
  work: () => Promise<T>,
  onInProgress: () => T,
) =>
  runIdempotent(
    idempotency as unknown as IdempotencyService,
    key,
    work,
    onInProgress,
  );

describe('runIdempotent', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('không có key thì chạy thẳng, không đụng Redis', async () => {
    const idempotency = createIdempotency();

    await expect(
      run(
        idempotency,
        undefined,
        () => Promise.resolve('ok'),
        () => 'busy',
      ),
    ).resolves.toBe('ok');
    expect(idempotency.get).not.toHaveBeenCalled();
    expect(idempotency.tryMarkInFlight).not.toHaveBeenCalled();
  });

  it('đã có response lưu thì trả lại, không chạy lại work và không giành khóa', async () => {
    const idempotency = createIdempotency();
    idempotency.get.mockResolvedValue({ id: 1 });
    const work = jest.fn();

    await expect(
      run(idempotency, 'k', work, () => ({ id: 0 })),
    ).resolves.toEqual({ id: 1 });
    expect(work).not.toHaveBeenCalled();
    expect(idempotency.tryMarkInFlight).not.toHaveBeenCalled();
  });

  it('không giành được khóa (request cùng key đang chạy) thì gọi onInProgress, không chạy work, không nhả khóa của người khác', async () => {
    const idempotency = createIdempotency();
    idempotency.tryMarkInFlight.mockResolvedValue(false);
    const work = jest.fn();

    await expect(run(idempotency, 'k', work, () => 'busy')).resolves.toBe(
      'busy',
    );
    expect(work).not.toHaveBeenCalled();
    expect(idempotency.clearInFlight).not.toHaveBeenCalled();
  });

  it('onInProgress ném lỗi (409) thì lỗi được ném ra', async () => {
    const idempotency = createIdempotency();
    idempotency.tryMarkInFlight.mockResolvedValue(false);

    await expect(
      run(idempotency, 'k', jest.fn(), () => {
        throw new Error('409');
      }),
    ).rejects.toThrow('409');
  });

  it('thành công: lưu response rồi nhả khóa', async () => {
    const idempotency = createIdempotency();

    await run(
      idempotency,
      'k',
      () => Promise.resolve({ ok: true }),
      () => ({ ok: false }),
    );

    expect(idempotency.set).toHaveBeenCalledWith('k', { ok: true });
    expect(idempotency.clearInFlight).toHaveBeenCalledWith('k');
  });

  it('work ném lỗi: lỗi được ném lại, KHÔNG lưu response, vẫn nhả khóa', async () => {
    const idempotency = createIdempotency();

    await expect(
      run(
        idempotency,
        'k',
        () => Promise.reject(new Error('lỗi nghiệp vụ')),
        () => null,
      ),
    ).rejects.toThrow('lỗi nghiệp vụ');
    expect(idempotency.set).not.toHaveBeenCalled();
    expect(idempotency.clearInFlight).toHaveBeenCalledWith('k');
  });

  it('lưu response lỗi (Redis chập chờn) thì request đã xử lý xong vẫn trả thành công + cảnh báo, khóa vẫn được nhả', async () => {
    const idempotency = createIdempotency();
    idempotency.set.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      run(
        idempotency,
        'k',
        () => Promise.resolve('done'),
        () => 'busy',
      ),
    ).resolves.toBe('done');
    expect(idempotency.clearInFlight).toHaveBeenCalledWith('k');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
  });

  it('nhả khóa lỗi thì không biến request thành công thành lỗi, và không che lỗi gốc của work', async () => {
    const idempotency = createIdempotency();
    idempotency.clearInFlight.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      run(
        idempotency,
        'k',
        () => Promise.resolve('done'),
        () => 'busy',
      ),
    ).resolves.toBe('done');
    await expect(
      run(
        idempotency,
        'k',
        () => Promise.reject(new Error('gốc')),
        () => 'busy',
      ),
    ).rejects.toThrow('gốc');
  });

  it('lỗi Redis khi giành khóa được ném lên (không chạy work khi không đảm bảo được tính duy nhất)', async () => {
    const idempotency = createIdempotency();
    idempotency.tryMarkInFlight.mockRejectedValue(new Error('ECONNREFUSED'));
    const work = jest.fn();

    await expect(run(idempotency, 'k', work, () => 'busy')).rejects.toThrow(
      'ECONNREFUSED',
    );
    expect(work).not.toHaveBeenCalled();
  });
});
