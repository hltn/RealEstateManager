import type { ProbeResult } from './baseline-probes/probe.types';
import { findPhaseOrderViolation } from './migration-phase';
import type { MigrationState } from './migration-state';
import type { PhaseFilter } from './migration.types';
import { BASELINE_MIGRATION_IDS } from './system.constants';
import { compareVersions, isValidVersion } from './version-compare.util';

/**
 * Kết luận của `planReconcile`. Ánh xạ sang mã thoát nằm ở runner (tránh phụ thuộc vòng):
 * READY -> 0, LOCKED -> 3, PROBE_FAILED -> 4, DOWNGRADE -> 5, REFUSED -> 1.
 * NEEDS_PROBES là kết luận TRUNG GIAN: cần chạy probe (chỉ đọc) cho `probeIds` rồi gọi lại với kết quả.
 */
export type ReconcileOutcome =
  | 'READY'
  | 'NEEDS_PROBES'
  | 'LOCKED'
  | 'PROBE_FAILED'
  | 'DOWNGRADE'
  | 'REFUSED';

export interface ReconcilePlan {
  outcome: ReconcileOutcome;
  /** Lý do (tiếng Việt) cho mọi kết luận khác READY; `null` khi READY. */
  reason: string | null;
  /** NEEDS_PROBES: id cần probe. PROBE_FAILED: id probe không đạt. Còn lại: rỗng. */
  probeIds: string[];
  /** READY: id 002..006 sẽ ghi sổ `by=baseline` kèm evidence (rỗng nếu không cần baseline). */
  baselineIds: string[];
  /** READY: id migration trong registry sẽ chạy theo thứ tự tăng dần. */
  pendingIds: string[];
  /** READY: version sẽ ghi vào `system` (`null` = không đổi, đã khớp). */
  versionToWrite: string | null;
  /**
   * READY: ghi `versionToWrite` NGAY cả khi chạy với `--skip-version`. Chỉ đúng cho DB mới tinh (version null, users
   * rỗng): không có dữ liệu nên không có rủi ro "code mới chưa chạy", và có version thì bước ghi version ở sau (khi
   * backend đã tạo user đầu tiên) không thể coi DB này là production cũ cần baseline.
   */
  forceVersionWrite: boolean;
  /** READY: không có gì để làm (không baseline, không migration, version đã khớp). */
  noop: boolean;
  /** Cảnh báo không chặn (ví dụ cùng version nhưng có migration mới). */
  warnings: string[];
}

export interface ReconcilePlanInput {
  state: MigrationState;
  appVersion: string;
  /** Kết quả probe đã chạy (nếu có); chỉ dùng cho id còn thiếu trong sổ. */
  probeResults?: readonly ProbeResult[];
  /** Id migration trong registry (từ 007 trở đi), đã hợp lệ (`assertValidRegistry`). */
  registryIds: readonly string[];
  /** Id (trong `registryIds`) có pha `post-up`; id khác coi là `pre-up`. Mặc định rỗng. */
  postUpIds?: readonly string[];
  /** Pha được chọn chạy (`--phase`); mặc định `all` = mọi migration chờ như trước đây. */
  phase?: PhaseFilter;
}

const emptyPlan = (
  outcome: ReconcileOutcome,
  reason: string | null,
  extra: Partial<ReconcilePlan> = {},
): ReconcilePlan => ({
  outcome,
  reason,
  probeIds: [],
  baselineIds: [],
  pendingIds: [],
  versionToWrite: null,
  forceVersionWrite: false,
  noop: false,
  warnings: [],
  ...extra,
});

/**
 * Sổ không liền mạch: có id ĐÃ vào sổ lớn hơn một id registry CHƯA vào sổ (chạy tiếp sẽ sai thứ tự). Trả id chưa chạy
 * đầu tiên bị vượt mặt, hoặc `null` nếu liền mạch. Id 002..006 luôn nhỏ hơn mọi id registry (từ 007) nên không gây lỗi.
 */
const findLedgerGap = (
  registryIds: readonly string[],
  appliedIds: ReadonlySet<string>,
): string | null => {
  const sorted = [...registryIds].sort((a, b) => a.localeCompare(b));
  const highestApplied = [...appliedIds].sort((a, b) => b.localeCompare(a))[0];
  if (highestApplied === undefined) return null;
  return (
    sorted.find(
      (id) => !appliedIds.has(id) && id.localeCompare(highestApplied) < 0,
    ) ?? null
  );
};

/**
 * HÀM THUẦN quyết định `reconcile` (không đọc/ghi DB), theo bảng trạng thái PT-027:
 *
 * 1. Có khóa -> LOCKED. 2. Version app/DB sai định dạng -> REFUSED. 3. App cũ hơn DB -> DOWNGRADE (không ghi gì).
 * 4. Sổ không liền mạch -> REFUSED. 5. `baselineRequired` (version null + users có dữ liệu + sổ thiếu 002..006):
 *    cần probe cho id còn thiếu (NEEDS_PROBES); có probe không đạt/thiếu kết quả -> PROBE_FAILED (KHÔNG baseline gì),
 *    đạt hết -> READY kèm `baselineIds`. 6. Còn lại READY: chạy migration chờ, ghi version nếu khác.
 *
 * Pha (FR-21): `phase` chỉ chọn migration chờ theo pha; chọn `pre-up` mà còn `post-up` chờ có số nhỏ hơn một `pre-up` chờ
 * -> REFUSED (mã 1, "chạy `--phase post-up` trước") để không tạo lỗ hổng sổ.
 *
 * `version` đã có trong DB thì TIN version (không baseline dù sổ thiếu 002..006); DB mới tinh (users rỗng) không baseline
 * và được ghi version ngay (`forceVersionWrite`) kể cả khi `--skip-version`.
 */
export const planReconcile = (input: ReconcilePlanInput): ReconcilePlan => {
  const { state, appVersion, probeResults, registryIds } = input;
  const phase = input.phase ?? 'all';
  const postUpIds = new Set(input.postUpIds ?? []);

  if (state.lock) {
    return emptyPlan(
      'LOCKED',
      `Đang có khóa migration-lock (${state.lock.by}). Không làm gì; nếu chắc chắn không có runner nào chạy, dùng \`unlock\`.`,
    );
  }
  if (!isValidVersion(appVersion)) {
    return emptyPlan(
      'REFUSED',
      `Phiên bản app "${appVersion}" sai định dạng semver (x.y.z).`,
    );
  }
  if (state.version && !isValidVersion(state.version.value)) {
    return emptyPlan(
      'REFUSED',
      `Phiên bản trong DB "${state.version.value}" sai định dạng semver; không tự đoán, cần người kiểm tra \`system.version\`.`,
    );
  }

  const order = state.version
    ? compareVersions(appVersion, state.version.value)
    : null;
  if (state.version && order === -1) {
    return emptyPlan(
      'DOWNGRADE',
      `Phiên bản app ${appVersion} CŨ hơn DB ${state.version.value} (downgrade). Không migrate, không hạ version trong DB.`,
    );
  }

  const appliedIds = new Set(state.applied.map((doc) => doc.id));
  const gap = findLedgerGap(registryIds, appliedIds);
  if (gap) {
    return emptyPlan(
      'REFUSED',
      `Sổ migration không liền mạch: ${gap} chưa chạy nhưng migration sau nó đã vào sổ. Từ chối để không chạy sai thứ tự.`,
    );
  }

  const baselineIds: string[] = [];
  if (state.baselineRequired) {
    const missing = BASELINE_MIGRATION_IDS.filter((id) => !appliedIds.has(id));
    const results = new Map((probeResults ?? []).map((r) => [r.id, r]));
    const unprobed = missing.filter((id) => !results.has(id));
    if (unprobed.length > 0) {
      return emptyPlan(
        'NEEDS_PROBES',
        'Cần probe chỉ-đọc cho các migration cũ chưa có trong sổ.',
        { probeIds: unprobed },
      );
    }
    const failed = missing.filter((id) => !results.get(id)?.passed);
    if (failed.length > 0) {
      return emptyPlan(
        'PROBE_FAILED',
        `Probe không đạt (${failed.join(', ')}): dữ liệu còn việc cho migration cũ. KHÔNG tự chạy 002..006; không ghi gì.`,
        { probeIds: failed },
      );
    }
    baselineIds.push(...missing);
  }

  const allPending = registryIds
    .filter((id) => !appliedIds.has(id))
    .sort((a, b) => a.localeCompare(b));
  // Quy tắc an toàn sổ theo pha (FR-21): không cho pre-up chạy vượt mặt post-up nhỏ hơn còn chờ.
  const phaseViolation = findPhaseOrderViolation(
    allPending.map((id) => ({
      id,
      phase: postUpIds.has(id) ? 'post-up' : 'pre-up',
    })),
    phase,
  );
  if (phaseViolation) return emptyPlan('REFUSED', phaseViolation);
  const pendingIds = allPending.filter(
    (id) => phase === 'all' || (phase === 'post-up') === postUpIds.has(id),
  );
  const warnings: string[] = [];
  if (order === 0 && pendingIds.length > 0) {
    warnings.push(
      `App và DB cùng version ${appVersion} nhưng có ${pendingIds.length} migration mới chờ (sổ là sự thật): vẫn chạy.`,
    );
  }
  const versionToWrite = order === 0 ? null : appVersion;
  const isFreshDb = state.version === null && !state.hasUsers;
  return emptyPlan('READY', null, {
    baselineIds,
    pendingIds,
    versionToWrite,
    forceVersionWrite: isFreshDb && versionToWrite !== null,
    warnings,
    noop:
      baselineIds.length === 0 &&
      pendingIds.length === 0 &&
      versionToWrite === null,
  });
};
