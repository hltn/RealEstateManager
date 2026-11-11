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

const byIdAsc = (a: string, b: string): number => a.localeCompare(b);

/**
 * Quy tắc an toàn sổ HAI CHIỀU (FR-21): một lần chạy theo pha không được ghi sổ vượt mặt migration pha KIA còn chờ có
 * số NHỎ HƠN (sổ phải liền mạch, nếu không `findLedgerGap` từ chối mọi lần `reconcile` sau):
 * - chạy `pre-up` mà còn `post-up` chờ số nhỏ hơn migration pre-up chờ cao nhất -> chạy `--phase post-up` trước;
 * - chạy `post-up` mà còn `pre-up` chờ số nhỏ hơn migration post-up chờ cao nhất -> chạy `--phase pre-up` trước
 *   (011 là MỘT CHIỀU: ghi sổ khi 010 chưa chạy thì pre-up chờ không bao giờ áp dụng được bằng runner).
 * `all` chạy theo thứ tự số nên luôn hợp lệ. Trả thông báo từ chối, hoặc `null` nếu hợp lệ. `allPending` là MỌI
 * migration chờ (cả hai pha), không phải danh sách đã lọc.
 */
export const findPhaseOrderViolation = (
  allPending: readonly PendingPhaseInfo[],
  filter: PhaseFilter,
): string | null => {
  if (filter === 'all') return null;
  const otherPhase: MigrationPhase = filter === 'pre-up' ? 'post-up' : 'pre-up';
  const runIds = allPending
    .filter((item) => item.phase === filter)
    .map((item) => item.id);
  if (runIds.length === 0) return null;
  const highestRun = [...runIds].sort(byIdAsc).at(-1) as string;
  // Migration pha kia có số nhỏ nhất còn chờ; nếu nhỏ hơn migration cao nhất sắp chạy thì chạy lúc này sẽ vượt mặt nó.
  const blocker = allPending
    .filter((item) => item.phase === otherPhase)
    .map((item) => item.id)
    .sort(byIdAsc)
    .find((id) => id.localeCompare(highestRun) < 0);
  if (blocker === undefined) return null;
  return (
    `Còn migration ${otherPhase} chờ ${blocker} có số nhỏ hơn migration ${filter} chờ ${highestRun}: ` +
    `chạy \`--phase ${otherPhase}\` trước (chạy ${filter} lúc này sẽ tạo lỗ hổng sổ).`
  );
};
