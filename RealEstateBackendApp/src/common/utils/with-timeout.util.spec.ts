import { withTimeout } from './with-timeout.util';

describe('withTimeout', () => {
  afterEach(() => jest.useRealTimers());

  it('promise xong trước hạn thì trả giá trị và không để timer treo', async () => {
    jest.useFakeTimers();

    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('quá hạn thì reject với message chỉ định', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(
      new Promise(() => undefined),
      500,
      'Redis quá chậm',
    );
    const assertion = expect(pending).rejects.toThrow('Redis quá chậm');

    jest.advanceTimersByTime(500);

    await assertion;
  });

  it('promise reject trước hạn thì giữ nguyên lỗi gốc', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('gốc')), 1000),
    ).rejects.toThrow('gốc');
  });
});
