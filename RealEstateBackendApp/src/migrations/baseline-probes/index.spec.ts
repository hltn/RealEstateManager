import type { Db } from 'mongodb';
import { BASELINE_MIGRATION_IDS } from '../system.constants';
import { BASELINE_PROBES, runBaselineProbes } from './index';

describe('baseline-probes/index', () => {
  it('có đúng một probe cho mỗi id 002..006, theo đúng thứ tự', () => {
    expect(BASELINE_PROBES.map((probe) => probe.id)).toEqual([
      ...BASELINE_MIGRATION_IDS,
    ]);
  });

  it('runBaselineProbes chỉ chạy các id được yêu cầu, theo thứ tự yêu cầu', async () => {
    const fakeDb = {
      listCollections: () => ({ toArray: () => Promise.resolve([]) }),
    } as unknown as Db;
    const results = await runBaselineProbes(fakeDb, [
      '003_drop_googledrivetokens_ttl_index',
    ]);
    expect(results).toEqual([
      {
        id: '003_drop_googledrivetokens_ttl_index',
        passed: true,
        counts: { ttlIndexes: 0 },
        warnings: [],
      },
    ]);
  });

  it('id không có probe thì ném lỗi thay vì âm thầm bỏ qua', async () => {
    await expect(runBaselineProbes({} as Db, ['999_unknown'])).rejects.toThrow(
      '999_unknown',
    );
  });
});
