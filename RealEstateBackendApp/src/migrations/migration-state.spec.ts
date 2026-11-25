import { selectPendingMigrations } from './migration-state';
import type { AppliedMigrationDoc } from './migration-state';
import type { Migration } from './migration.types';

const make = (id: string, phase?: Migration['phase']): Migration => ({
  id,
  description: `mô tả ${id}`,
  ...(phase ? { phase } : {}),
  up: () => Promise.resolve(),
});

const applied = (...ids: string[]): AppliedMigrationDoc[] =>
  ids.map((id) => ({ id, at: new Date(0), by: 'cli' }));

const REGISTRY = [
  make('007_a'),
  make('008_b', 'pre-up'),
  make('009_c', 'post-up'),
];

describe('selectPendingMigrations (lọc theo pha, FR-21)', () => {
  it('FR-21: mặc định (all) trả mọi migration chờ theo thứ tự số, giữ hành vi cũ', () => {
    expect(selectPendingMigrations(REGISTRY, []).map((m) => m.id)).toEqual([
      '007_a',
      '008_b',
      '009_c',
    ]);
  });

  it('FR-21: migration không khai báo phase được coi là pre-up', () => {
    expect(
      selectPendingMigrations(REGISTRY, [], 'pre-up').map((m) => m.id),
    ).toEqual(['007_a', '008_b']);
  });

  it('FR-21: post-up chỉ trả migration post-up', () => {
    expect(
      selectPendingMigrations(REGISTRY, [], 'post-up').map((m) => m.id),
    ).toEqual(['009_c']);
  });

  it('FR-21: vẫn loại migration đã vào sổ (chạy lại idempotent)', () => {
    expect(
      selectPendingMigrations(REGISTRY, applied('007_a', '009_c'), 'all').map(
        (m) => m.id,
      ),
    ).toEqual(['008_b']);
    expect(
      selectPendingMigrations(REGISTRY, applied('009_c'), 'post-up'),
    ).toEqual([]);
  });

  it('FR-21: sắp theo số tăng dần kể cả khi registry đưa vào lộn xộn', () => {
    const shuffled = [REGISTRY[2], REGISTRY[0], REGISTRY[1]];
    expect(selectPendingMigrations(shuffled, []).map((m) => m.id)).toEqual([
      '007_a',
      '008_b',
      '009_c',
    ]);
  });
});
