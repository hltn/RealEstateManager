/* eslint-disable @typescript-eslint/require-await -- fake `work`/callback async theo chữ ký, không cần await */
/**
 * FR-03 — hook sau-commit của withTransaction (unit, dùng connection giả mô phỏng commit/abort/retry).
 */
import { Logger } from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';
import { registerAfterCommit } from './after-commit.util';
import { withTransaction } from './with-transaction.util';

type Work = (session: ClientSession) => Promise<unknown>;

/** Mô phỏng `connection.transaction`: dùng MỘT session, chạy lại `work` `transientFailures` lần (retry). */
function fakeConnection(transientFailures = 0): Connection {
  const session = {} as ClientSession;
  return {
    transaction: jest.fn(async (fn: Work) => {
      for (let failed = 0; ; failed += 1) {
        const value = await fn(session);
        if (failed < transientFailures) continue;
        return value;
      }
    }),
  } as unknown as Connection;
}

describe('withTransaction + registerAfterCommit (FR-03)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('FR-03: commit thành công thì callback chạy SAU khi work xong và kết quả được trả nguyên vẹn', async () => {
    const order: string[] = [];
    const result = await withTransaction(fakeConnection(), async (session) => {
      void registerAfterCommit(session, () => {
        order.push('after');
      });
      order.push('work-end');
      return 42;
    });

    expect(result).toBe(42);
    expect(order).toEqual(['work-end', 'after']);
  });

  it('FR-03: rollback (work ném lỗi) thì callback KHÔNG chạy và lỗi gốc được ném lại', async () => {
    const callback = jest.fn();
    const failure = new Error('nghiệp vụ lỗi');
    const conn = {
      transaction: jest.fn(async (fn: Work) => fn({} as ClientSession)),
    } as unknown as Connection;

    await expect(
      withTransaction(conn, async (session) => {
        void registerAfterCommit(session, callback);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(callback).not.toHaveBeenCalled();
  });

  it('FR-03: commit thất bại sau khi work chạy xong thì callback KHÔNG chạy', async () => {
    const callback = jest.fn();
    const commitError = new Error('commit thất bại');
    const conn = {
      transaction: jest.fn(async (fn: Work) => {
        await fn({} as ClientSession);
        throw commitError;
      }),
    } as unknown as Connection;

    await expect(
      withTransaction(conn, async (session) => {
        void registerAfterCommit(session, callback);
      }),
    ).rejects.toBe(commitError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('FR-03: retry work (TransientTransactionError) không chạy callback hai lần', async () => {
    const callback = jest.fn();
    const work = jest.fn(async (session: ClientSession) => {
      void registerAfterCommit(session, callback);
    });

    await withTransaction(fakeConnection(2), work);

    expect(work).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('FR-03: callback ném lỗi (đồng bộ hay bất đồng bộ) chỉ ghi log, kết quả vẫn trả về và callback sau vẫn chạy', async () => {
    const after = jest.fn();
    const result = await withTransaction(fakeConnection(), async (session) => {
      void registerAfterCommit(session, () => {
        throw new Error('đồng bộ');
      });
      void registerAfterCommit(session, async () => {
        throw new Error('bất đồng bộ');
      });
      void registerAfterCommit(session, after);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(after).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('FR-03: nhiều callback chạy tuần tự đúng thứ tự đăng ký (callback bất đồng bộ được chờ xong)', async () => {
    const order: number[] = [];
    await withTransaction(fakeConnection(), async (session) => {
      void registerAfterCommit(session, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(1);
      });
      void registerAfterCommit(session, () => {
        order.push(2);
      });
      void registerAfterCommit(session, () => {
        order.push(3);
      });
    });

    expect(order).toEqual([1, 2, 3]);
  });

  it('FR-03: gọi ngoài transaction (session lạ hoặc không có) thì chạy ngay, lỗi cũng không ném', async () => {
    const callback = jest.fn();
    await registerAfterCommit({} as ClientSession, callback);
    await registerAfterCommit(undefined, callback);
    expect(callback).toHaveBeenCalledTimes(2);

    await expect(
      registerAfterCommit(undefined, () => {
        throw new Error('lỗi');
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('FR-03: đăng ký trên session cũ đã kết thúc thì chạy ngay, không bị treo', async () => {
    let saved!: ClientSession;
    await withTransaction(fakeConnection(), async (session) => {
      saved = session;
    });
    const callback = jest.fn();
    await registerAfterCommit(saved, callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('FR-03: hai transaction đồng thời không lẫn callback của nhau', async () => {
    const committed = jest.fn();
    const aborted = jest.fn();
    const okConn = {
      transaction: async (fn: Work) => fn({} as ClientSession),
    } as unknown as Connection;
    const badConn = {
      transaction: async (fn: Work) => {
        await fn({} as ClientSession);
        throw new Error('commit lỗi');
      },
    } as unknown as Connection;

    await Promise.all([
      withTransaction(okConn, async (s) => {
        void registerAfterCommit(s, committed);
      }),
      withTransaction(badConn, async (s) => {
        void registerAfterCommit(s, aborted);
      }).catch(() => undefined),
    ]);

    expect(committed).toHaveBeenCalledTimes(1);
    expect(aborted).not.toHaveBeenCalled();
  });
});
