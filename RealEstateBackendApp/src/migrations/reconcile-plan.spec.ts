import type { ProbeResult } from './baseline-probes/probe.types';
import type { AppliedMigrationDoc, MigrationState } from './migration-state';
import { planReconcile } from './reconcile-plan';
import { BASELINE_MIGRATION_IDS } from './system.constants';

const AT = new Date('2026-01-01T00:00:00.000Z');

const applied = (...ids: string[]): AppliedMigrationDoc[] =>
  ids.map((id) => ({ id, at: AT, by: 'baseline' }));

const state = (overrides: Partial<MigrationState> = {}): MigrationState => ({
  version: null,
  applied: [],
  lock: null,
  lastError: null,
  baselineRequired: false,
  hasUsers: false,
  ...overrides,
});

const withVersion = (value: string): MigrationState['version'] => ({
  value,
  commit: null,
  updatedAt: AT,
});

const probe = (
  id: string,
  passed = true,
  counts: Record<string, number> = {},
): ProbeResult => ({ id, passed, counts, warnings: [] });

const allPass = BASELINE_MIGRATION_IDS.map((id) => probe(id));
const REGISTRY = ['007_one', '008_two'];

describe('planReconcile', () => {
  describe('DB mới (users rỗng, baselineRequired=false)', () => {
    it('không baseline; chạy toàn bộ migration chờ; ghi version', () => {
      const plan = planReconcile({
        state: state(),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        baselineIds: [],
        pendingIds: REGISTRY,
        versionToWrite: '1.0.3',
        noop: false,
      });
    });

    it('DB mới tinh (version null, users rỗng): forceVersionWrite=true để --skip-version vẫn ghi version', () => {
      const plan = planReconcile({
        state: state({ hasUsers: false }),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        versionToWrite: '1.0.3',
        forceVersionWrite: true,
      });
    });

    it('forceVersionWrite=false khi users có dữ liệu (sổ đủ, version null) hoặc khi DB đã có version', () => {
      const resume = planReconcile({
        state: state({
          hasUsers: true,
          applied: applied(...BASELINE_MIGRATION_IDS),
        }),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(resume.forceVersionWrite).toBe(false);
      const hasVersion = planReconcile({
        state: state({ version: withVersion('1.0.2'), hasUsers: false }),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(hasVersion.forceVersionWrite).toBe(false);
    });

    it('registry rỗng: chỉ ghi version', () => {
      const plan = planReconcile({
        state: state(),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        pendingIds: [],
        versionToWrite: '1.0.3',
        noop: false,
      });
    });
  });

  describe('production cũ (version null, users có dữ liệu, sổ thiếu 002..006)', () => {
    const legacy = state({ baselineRequired: true, hasUsers: true });

    it('chưa có kết quả probe -> NEEDS_PROBES cho đủ 5 id', () => {
      const plan = planReconcile({
        state: legacy,
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan.outcome).toBe('NEEDS_PROBES');
      expect(plan.probeIds).toEqual([...BASELINE_MIGRATION_IDS]);
      expect(plan.baselineIds).toEqual([]);
    });

    it('đạt hết -> READY, baseline cả 5 rồi chạy migration chờ rồi ghi version', () => {
      const plan = planReconcile({
        state: legacy,
        appVersion: '1.0.3',
        probeResults: allPass,
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        baselineIds: [...BASELINE_MIGRATION_IDS],
        pendingIds: REGISTRY,
        versionToWrite: '1.0.3',
        noop: false,
      });
    });

    it('một probe fail -> PROBE_FAILED, nêu đúng id fail, KHÔNG có baselineIds/pendingIds', () => {
      const failing = allPass.map((result) =>
        result.id === '005_users_roles_teamids'
          ? probe(result.id, false, { pendingUsers: 3 })
          : result,
      );
      const plan = planReconcile({
        state: legacy,
        appVersion: '1.0.3',
        probeResults: failing,
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'PROBE_FAILED',
        probeIds: ['005_users_roles_teamids'],
        baselineIds: [],
        pendingIds: [],
        versionToWrite: null,
      });
    });

    it('nhiều probe fail -> liệt kê hết', () => {
      const failing = allPass.map((result) =>
        ['002_recompute_urlhash_sha256', '006_areas_34_provinces'].includes(
          result.id,
        )
          ? probe(result.id, false)
          : result,
      );
      const plan = planReconcile({
        state: legacy,
        appVersion: '1.0.3',
        probeResults: failing,
        registryIds: [],
      });
      expect(plan.outcome).toBe('PROBE_FAILED');
      expect(plan.probeIds).toEqual([
        '002_recompute_urlhash_sha256',
        '006_areas_34_provinces',
      ]);
    });

    it('sổ đã có một phần (002..004): chỉ probe và baseline id còn thiếu (005, 006)', () => {
      const partial = state({
        baselineRequired: true,
        hasUsers: true,
        applied: applied(...BASELINE_MIGRATION_IDS.slice(0, 3)),
      });
      const needs = planReconcile({
        state: partial,
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(needs.probeIds).toEqual([
        '005_users_roles_teamids',
        '006_areas_34_provinces',
      ]);
      const ready = planReconcile({
        state: partial,
        appVersion: '1.0.3',
        probeResults: allPass,
        registryIds: [],
      });
      expect(ready.baselineIds).toEqual([
        '005_users_roles_teamids',
        '006_areas_34_provinces',
      ]);
    });

    it('kết quả probe thiếu một id cần dùng -> vẫn NEEDS_PROBES (không coi là đạt)', () => {
      const plan = planReconcile({
        state: legacy,
        appVersion: '1.0.3',
        probeResults: allPass.slice(0, 4),
        registryIds: [],
      });
      expect(plan.outcome).toBe('NEEDS_PROBES');
      expect(plan.probeIds).toEqual(['006_areas_34_provinces']);
    });

    it('kết quả probe của id ĐÃ có trong sổ bị bỏ qua (probe fail của id đó không chặn)', () => {
      const partial = state({
        baselineRequired: true,
        hasUsers: true,
        applied: applied('002_recompute_urlhash_sha256'),
      });
      const results = allPass.map((result) =>
        result.id === '002_recompute_urlhash_sha256'
          ? probe(result.id, false)
          : result,
      );
      const plan = planReconcile({
        state: partial,
        appVersion: '1.0.3',
        probeResults: results,
        registryIds: [],
      });
      expect(plan.outcome).toBe('READY');
      expect(plan.baselineIds).not.toContain('002_recompute_urlhash_sha256');
    });
  });

  describe('baseline dở dang (version null, sổ đủ 002..006 => baselineRequired=false)', () => {
    it('bỏ qua probe, chạy tiếp migration chờ và ghi version', () => {
      const plan = planReconcile({
        state: state({ applied: applied(...BASELINE_MIGRATION_IDS) }),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        baselineIds: [],
        pendingIds: REGISTRY,
        versionToWrite: '1.0.3',
      });
    });

    it('sổ đủ, registry rỗng: chỉ còn ghi version (không noop)', () => {
      const plan = planReconcile({
        state: state({ applied: applied(...BASELINE_MIGRATION_IDS) }),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan).toMatchObject({ outcome: 'READY', noop: false });
      expect(plan.versionToWrite).toBe('1.0.3');
    });
  });

  describe('so version app với DB', () => {
    const upToDate = (value: string) =>
      state({
        version: withVersion(value),
        applied: applied(...BASELINE_MIGRATION_IDS),
      });

    it('app == DB, không migration chờ -> noop', () => {
      const plan = planReconcile({
        state: upToDate('1.0.3'),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        noop: true,
        versionToWrite: null,
        pendingIds: [],
        warnings: [],
      });
    });

    it('app == DB nhưng có migration chờ -> vẫn chạy, KHÔNG ghi lại version, có cảnh báo', () => {
      const plan = planReconcile({
        state: upToDate('1.0.3'),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        pendingIds: REGISTRY,
        versionToWrite: null,
        noop: false,
      });
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain('cùng version');
    });

    it('app == DB khác nhau chỉ ở build metadata -> coi là bằng nhau', () => {
      const plan = planReconcile({
        state: upToDate('1.0.3+abc'),
        appVersion: '1.0.3+xyz',
        registryIds: [],
      });
      expect(plan.noop).toBe(true);
    });

    it('app > DB -> chạy migration chờ và ghi version mới', () => {
      const plan = planReconcile({
        state: upToDate('1.0.2'),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        pendingIds: REGISTRY,
        versionToWrite: '1.0.3',
      });
    });

    it('app > DB, không migration chờ -> chỉ ghi version', () => {
      const plan = planReconcile({
        state: upToDate('1.0.2'),
        appVersion: '1.0.10',
        registryIds: [],
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        pendingIds: [],
        versionToWrite: '1.0.10',
        noop: false,
      });
    });

    it('app < DB (downgrade) -> DOWNGRADE, không ghi gì dù có migration chờ', () => {
      const plan = planReconcile({
        state: upToDate('1.0.4'),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({
        outcome: 'DOWNGRADE',
        pendingIds: [],
        baselineIds: [],
        versionToWrite: null,
      });
      expect(plan.reason).toContain('1.0.4');
    });

    it('app là pre-release của chính DB (1.0.3-rc.1 so với 1.0.3) -> DOWNGRADE', () => {
      const plan = planReconcile({
        state: upToDate('1.0.3'),
        appVersion: '1.0.3-rc.1',
        registryIds: [],
      });
      expect(plan.outcome).toBe('DOWNGRADE');
    });

    it('sổ có version nhưng thiếu 002..006 (baselineRequired=false): tin version, không probe, không baseline', () => {
      const plan = planReconcile({
        state: state({ version: withVersion('1.0.2'), applied: [] }),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan).toMatchObject({
        outcome: 'READY',
        baselineIds: [],
        probeIds: [],
        versionToWrite: '1.0.3',
      });
    });
  });

  describe('từ chối / dừng', () => {
    it('có khóa -> LOCKED, ưu tiên trước mọi thứ khác (kể cả downgrade, probe)', () => {
      const plan = planReconcile({
        state: state({
          lock: { at: AT, by: 'deploy' },
          version: withVersion('9.0.0'),
          baselineRequired: true,
          hasUsers: true,
        }),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan.outcome).toBe('LOCKED');
      expect(plan.reason).toContain('deploy');
    });

    it('version trong DB sai định dạng -> REFUSED', () => {
      const plan = planReconcile({
        state: state({ version: withVersion('abc') }),
        appVersion: '1.0.3',
        registryIds: [],
      });
      expect(plan.outcome).toBe('REFUSED');
      expect(plan.reason).toContain('abc');
    });

    it('version của app sai định dạng -> REFUSED', () => {
      const plan = planReconcile({
        state: state(),
        appVersion: 'latest',
        registryIds: [],
      });
      expect(plan.outcome).toBe('REFUSED');
    });

    it('sổ không liền mạch (008 đã chạy, 007 chưa) -> REFUSED', () => {
      const plan = planReconcile({
        state: state({
          version: withVersion('1.0.2'),
          applied: applied('008_two'),
        }),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan.outcome).toBe('REFUSED');
      expect(plan.reason).toContain('007_one');
    });

    it('sổ liền mạch (007 đã chạy, 008 chờ) -> chạy tiếp 008', () => {
      const plan = planReconcile({
        state: state({
          version: withVersion('1.0.2'),
          applied: applied('007_one'),
        }),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan).toMatchObject({ outcome: 'READY', pendingIds: ['008_two'] });
    });

    it('chỉ có id 002..006 trong sổ không bị coi là hở so với registry từ 007', () => {
      const plan = planReconcile({
        state: state({ applied: applied(...BASELINE_MIGRATION_IDS) }),
        appVersion: '1.0.3',
        registryIds: REGISTRY,
      });
      expect(plan.outcome).toBe('READY');
    });
  });
});
