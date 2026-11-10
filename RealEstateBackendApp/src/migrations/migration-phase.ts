import type { Migration, MigrationPhase, PhaseFilter } from './migration.types';

/** Pha thực của migration (mặc định `pre-up` khi không khai báo). */
export const getMigrationPhase = (
  migration: Pick<Migration, 'phase'>,
): MigrationPhase => migration.phase ?? 'pre-up';

/** Migration có thuộc bộ lọc pha không (`all` nhận mọi pha). */
export const matchesPhase = (
  phase: MigrationPhase,
  filter: PhaseFilter,
): boolean => filter === 'all' || phase === filter;

/** Mô tả tối thiểu một migration chờ để kiểm quy tắc pha (id dạng `NNN_ten`, so sánh theo chuỗi như registry). */
export interface PendingPhaseInfo {
  id: string;
  phase: MigrationPhase;
}

/**
 * Quy tắc an toàn sổ (FR-21): chạy `pre-up` mà còn migration `post-up` chờ có số NHỎ HƠN một migration `pre-up` chờ
 * thì sẽ tạo lỗ hổng sổ (`findLedgerGap`). Trả thông báo từ chối, hoặc `null` nếu hợp lệ. `allPending` là MỌI migration
 * chờ (cả hai pha), không phải danh sách đã lọc.
 */
export const findPhaseOrderViolation = (
  allPending: readonly PendingPhaseInfo[],
  filter: PhaseFilter,
): string | null => {
  if (filter !== 'pre-up') return null;
  const preUpIds = allPending
    .filter((item) => item.phase === 'pre-up')
    .map((item) => item.id);
  if (preUpIds.length === 0) return null;
  const highestPreUp = [...preUpIds].sort((a, b) => b.localeCompare(a))[0];
  const blocker = allPending
    .filter((item) => item.phase === 'post-up')
    .map((item) => item.id)
    .sort((a, b) => a.localeCompare(b))
    .find((id) => id.localeCompare(highestPreUp) < 0);
  if (blocker === undefined) return null;
  return `Còn migration post-up chờ ${blocker} có số nhỏ hơn migration pre-up chờ ${highestPreUp}: chạy \`--phase post-up\` trước (chạy pre-up lúc này sẽ tạo lỗ hổng sổ).`;
};
