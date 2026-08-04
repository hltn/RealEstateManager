# Async Manual Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển "Chạy quy trình thu thập" (manual crawl) từ đồng bộ sang bất đồng bộ như "phân tích tin tức", có status pill trên header.

**Architecture:** Tái dụng `AnalyzeJobService` (in-memory job tracker, TTL 1h) + `IdempotencyService` (lock `crawl:global` shared với bulk crawl) + helper `runLockedJob`/`runJob` đã có. BE: `POST /crawl` trả `{ jobId }` ngay, work chạy nền; thêm `GET /crawl/:jobId` poll. FE: thêm `ManualCrawlJobProvider` (poll 3s) đẩy vào `setCrawlStatus` chung, `RawArticlesScreen` gọi `startJob` thay vì await data.

**Tech Stack:** NestJS + TypeScript (BE, Jest), ReactJS + TypeScript + TanStack Query (FE, không có test runner FE → verify bằng typecheck/build + manual).

## Global Constraints

- Backend test runner: `cd RealEstateBackendApp && npx jest <path>`. Mocking theo `news-fire-crawl-manager.controller.spec.ts` (custom providers, `jest.mock('fs')` factory, `jest.mock('jsdom', () => ({}))`).
- Tôn trọng convention hiện có: 1 React Context provider / job type; comment tiếng Việt; fire-and-forget có `.catch` safety net.
- Không đụng cron flow (`cronjob.service.ts`) và bulk crawl logic.
- `fs` mock trong controller spec đã expose `readFileSync` + `promises.unlink` — tái dùng, không thêm.

---

### Task 1: Backend — async-ify `triggerManualCrawl` + poll endpoint + audit enum

**Files:**
- Modify: `RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/audit-log.schema.ts:4-15` (thêm enum value)
- Modify: `RealEstateBackendApp/src/modules/news-fire-crawl-manager/news-fire-crawl-manager.controller.ts:245-269` (đổi `triggerManualCrawl`) + thêm method `runManualCrawlJob` + thêm endpoint `getManualCrawlJob`
- Modify: `RealEstateBackendApp/src/modules/news-fire-crawl-manager/news-fire-crawl-manager.controller.spec.ts:270-286` (thay test cũ) + thêm `getManualCrawlJob` tests + cập nhật header comment line 13

**Interfaces:**
- Consumes: `AnalyzeJobService.createJob()/getJob()/markDone()/markError()`, `IdempotencyService.isInFlight()/markInFlight()/clearInFlight()`, `runLockedJob(jobId, lockKey, jobLabel, work)`, `CustomCrawlerService.crawlData(days, startDate, endDate) → { filePath, stats }`, `AuditLogService.log(action, collectionName, documentIds, actor, metadata)`.
- Produces: `POST /news-manager/crawl` → `{ message: string, jobId: string }`; `GET /news-manager/crawl/:jobId` → `AnalyzeJob | { status: 'not_found' }`; `AuditAction.MANUAL_CRAWL`.

- [ ] **Step 1: Write failing tests (replace old triggerManualCrawl describe block at spec line 270-286)**

Replace the whole `describe('triggerManualCrawl', ...)` block (lines 270-286) with:

```ts
  describe('triggerManualCrawl (async)', () => {
    it('trả { message, jobId } ngay, markInFlight crawl:global + tạo job + audit', async () => {
      analyzeJobService.createJob.mockReturnValue('job-1');
      customCrawlerService.crawlData.mockResolvedValue({
        filePath: '/tmp/x.json',
        stats: { successfulSources: 1, failedSources: 0, totalArticles: 2 },
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([{ a: 1 }, { b: 2 }]));

      const result = await controller.triggerManualCrawl({ days: 3 } as any);

      expect(idempotencyService.markInFlight).toHaveBeenCalledWith('crawl:global');
      expect(analyzeJobService.createJob).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Crawl started', jobId: 'job-1' });
      expect(auditLogService.log).toHaveBeenCalledWith(
        AuditAction.MANUAL_CRAWL,
        'raw_articles',
        [],
        'system',
        expect.objectContaining({ jobId: 'job-1', days: 3 }),
      );
    });

    it('lock in-flight → ConflictException, không tạo job / không audit', async () => {
      idempotencyService.isInFlight.mockReturnValue(true);
      await expect(controller.triggerManualCrawl({ days: 3 } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      expect(auditLogService.log).not.toHaveBeenCalled();
    });

    it('chạy nền: crawlData(days,...) + markDone count + clearInFlight', async () => {
      analyzeJobService.createJob.mockReturnValue('job-2');
      customCrawlerService.crawlData.mockResolvedValue({
        filePath: '/tmp/y.json',
        stats: { successfulSources: 1, failedSources: 0, totalArticles: 2 },
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([{ a: 1 }, { b: 2 }]));

      await controller.triggerManualCrawl({ days: 3 } as any);
      // Flush fire-and-forget microtasks (crawlData là async, runJob await work()).
      await new Promise(setImmediate);

      expect(customCrawlerService.crawlData).toHaveBeenCalledWith(3, undefined, undefined);
      expect(analyzeJobService.markDone).toHaveBeenCalledWith('job-2', {
        stats: { successfulSources: 1, failedSources: 0, totalArticles: 2 },
        count: 2,
        filePath: '/tmp/y.json',
      });
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('crawl:global');
    });
  });

  describe('getManualCrawlJob', () => {
    it('jobId không có → { status: not_found }', () => {
      analyzeJobService.getJob.mockReturnValue(undefined);
      expect(controller.getManualCrawlJob('missing')).toEqual({ status: 'not_found' });
    });

    it('job có → trả nguyên job object', () => {
      const job = { status: 'done', result: { count: 5 } };
      analyzeJobService.getJob.mockReturnValue(job as any);
      expect(controller.getManualCrawlJob('job-1')).toEqual(job);
    });
  });
```

Also update the file header comment at line 13 from:
`* - triggerManualCrawl → đọc file tạm và trả data.`
to:
`* - triggerManualCrawl (async) → trả { message, jobId } ngay, crawlData chạy nền + markDone; ConflictException khi lock in-flight.`
And append after line 14 (triggerManualAnalyze line): `* - getManualCrawlJob → poll trạng thái job crawl, not_found khi hết TTL.`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd RealEstateBackendApp && npx jest news-fire-crawl-manager.controller.spec.ts --no-coverage`
Expected: FAIL — `AuditAction.MANUAL_CRAWL` không tồn tại, `triggerManualCrawl` vẫn trả `{ message, filePath, stats, data }`, `getManualCrawlJob` chưa định nghĩa.

- [ ] **Step 3: Add `MANUAL_CRAWL` AuditAction enum value**

In `audit-log.schema.ts`, add to the `AuditAction` enum (after `MARKET_ANALYSIS_BULK`, before closing brace):

```ts
  /**
   * Admin trigger thu thập thủ công (chạy nền). Backward compatible: chỉ thêm
   * giá trị enum mới, document cũ không bị ảnh hưởng.
   */
  MANUAL_CRAWL = 'MANUAL_CRAWL',
```

- [ ] **Step 4: Rewrite `triggerManualCrawl` + add `runManualCrawlJob` + `getManualCrawlJob`**

In `news-fire-crawl-manager.controller.ts`, replace lines 245-269 (the `@ApiOperation` + `@Post('crawl')` + `triggerManualCrawl` method) with:

```ts
  @ApiOperation({
    summary: 'Trigger manual crawl (async)',
    description:
      'Trả về jobId ngay lập tức, việc crawl + AI extract (có thể mất vài phút) chạy nền. ' +
      'Dùng GET /crawl/:jobId để poll trạng thái khi hoàn tất.',
  })
  @Post('crawl')
  triggerManualCrawl(@Body() body: TriggerManualCrawlDto) {
    const { days, startDate, endDate } = body;
    this.logger.log(
      `Manual crawl called. Days: ${days || 'none'}, Start: ${startDate || 'none'}, End: ${endDate || 'none'}`,
    );

    // Khóa global dùng chung với bulk crawl — chống 2 job crawl chạy song song
    // (double-click FE, 2 tab/client): tránh tốn API cost gấp đôi và upsert articles đè nhau.
    const LOCK_KEY = 'crawl:global';
    if (this.idempotencyService.isInFlight(LOCK_KEY)) {
      throw new ConflictException(
        'Đang có tác vụ thu thập đang chạy, vui lòng đợi hoàn tất',
      );
    }
    this.idempotencyService.markInFlight(LOCK_KEY);

    const jobId = this.analyzeJobService.createJob();

    // Audit: admin trigger manual crawl — fire-and-forget, chỉ audit khi đã qua lock
    // (không audit khi Conflict). Giống pattern market-analysis-bulk.
    void this.auditLogService.log(
      AuditAction.MANUAL_CRAWL,
      'raw_articles',
      [],
      'system',
      { jobId, days, startDate, endDate },
    );

    // Fire-and-forget: không await trong request handler để HTTP response trả về ngay,
    // tránh phụ thuộc thời gian crawl thực tế (gây Axios timeout phía FE) — giống
    // pattern analyze-raw / analyze-market-trends. `.catch` safety net chống
    // unhandled rejection ngoài dự kiến.
    void this.runManualCrawlJob(jobId, days, startDate, endDate, LOCK_KEY).catch(
      (err: any) =>
        this.logger.error(
          `Manual crawl fire-and-forget rejected: ${err?.message}`,
          err?.stack,
        ),
    );

    return { message: 'Crawl started', jobId };
  }

  /**
   * Thực thi job crawl thủ công trong nền. Lifecycle (markDone/markError/
   * clearInFlight) delegate cho runLockedJob chung (DRY) — giống runAnalyzeMarketTrendsJob.
   */
  private runManualCrawlJob(
    jobId: string,
    days: number | undefined,
    startDate: string | undefined,
    endDate: string | undefined,
    lockKey: string,
  ): Promise<void> {
    return this.runLockedJob(jobId, lockKey, 'Manual crawl job', async () => {
      const { filePath, stats } = await this.customCrawlerService.crawlData(
        days,
        startDate,
        endDate,
      );
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        stats,
        count: Array.isArray(rawData) ? rawData.length : 0,
        filePath,
      };
    });
  }

  @ApiOperation({
    summary: 'Get manual crawl job status',
    description: 'Poll trạng thái job crawl chạy nền theo jobId.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'ID job trả về từ POST /crawl',
  })
  @Get('crawl/:jobId')
  getManualCrawlJob(@Param('jobId') jobId: string) {
    const job = this.analyzeJobService.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }
    return job;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd RealEstateBackendApp && npx jest news-fire-crawl-manager.controller.spec.ts --no-coverage`
Expected: PASS — all `triggerManualCrawl (async)` + `getManualCrawlJob` tests green. Nếu test "chạy nền" flaky do `setImmediate`, thử thay bằng `await new Promise((r) => setTimeout(r, 0));` rồi `await Promise.resolve()`.

- [ ] **Step 6: Run full backend test suite to ensure no regression**

Run: `cd RealEstateBackendApp && npx jest --no-coverage`
Expected: PASS — all previously green suites still green (226 tests / 15 suites baseline).

- [ ] **Step 7: Commit**

```bash
cd D:/Jobs/RealEstateManager
git add RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/audit-log.schema.ts \
        RealEstateBackendApp/src/modules/news-fire-crawl-manager/news-fire-crawl-manager.controller.ts \
        RealEstateBackendApp/src/modules/news-fire-crawl-manager/news-fire-crawl-manager.controller.spec.ts
git commit -m "feat(crawl): async manual crawl with jobId + poll endpoint + audit

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Frontend — `ManualCrawlJobProvider` context + register in AppLayout

**Files:**
- Create: `RealEstateAdminApp/src/context/ManualCrawlJobContext.tsx`
- Modify: `RealEstateAdminApp/src/layout/AppLayout.tsx:1-48`

**Interfaces:**
- Consumes: `useManageWpStatus().setCrawlStatus` (OpStatus `"idle"|"pending"|"done"|"error"`), `apiAxios.get`, Tanstack `useQuery`/`useQueryClient`, query key `["raw-articles"]` (existing list key in `RawArticlesScreen`).
- Produces: `useManualCrawlJob()` → `{ startJob: (jobId: string) => void; doneResult: { stats?: unknown; count?: number; filePath?: string } | null }`. Poll endpoint `GET /news-manager/crawl/:jobId`.

- [ ] **Step 1: Create `ManualCrawlJobContext.tsx`**

Create `RealEstateAdminApp/src/context/ManualCrawlJobContext.tsx` with:

```tsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiAxios from "../api/axios";
import { useManageWpStatus } from "./ManageWpStatusContext";

/** Phản hồi từ GET /news-manager/crawl/:jobId. */
export interface ManualCrawlJobResponse {
  status: "pending" | "done" | "error" | "not_found";
  result?: { stats?: unknown; count?: number; filePath?: string };
  error?: string;
}

interface ManualCrawlJobContextType {
  /** Bắt đầu theo dõi 1 job crawl thủ công (gọi ngay sau khi POST /crawl trả về jobId). */
  startJob: (jobId: string) => void;
  /** Kết quả khi job done (count/stats). Reset khi startJob mới. */
  doneResult: ManualCrawlJobResponse["result"] | null;
}

const ManualCrawlJobContext = createContext<ManualCrawlJobContextType | undefined>(undefined);

export const useManualCrawlJob = () => {
  const context = useContext(ManualCrawlJobContext);
  if (!context) {
    throw new Error("useManualCrawlJob must be used within a ManualCrawlJobProvider");
  }
  return context;
};

/**
 * Poll trạng thái job thu thập thủ công (nút "Chạy quy trình thu thập" ở RawArticlesScreen).
 *
 * Provider sống ở AppLayout nên việc poll độc lập với RawArticlesScreen — vẫn chạy
 * dù user rời màn. Khi job kết thúc, provider đẩy trạng thái vào ManageWpStatusContext
 * (để CrawlStatusBadge trên header hiển thị, dùng chung với bulk crawl) và làm mới
 * danh sách `raw-articles` khi crawl xong.
 */
export const ManualCrawlJobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const { setCrawlStatus } = useManageWpStatus();
  const [jobId, setJobId] = useState<string | null>(null);
  const [doneResult, setDoneResult] = useState<ManualCrawlJobResponse["result"] | null>(null);

  const { data, isError, error } = useQuery<ManualCrawlJobResponse>({
    queryKey: ["manual-crawl-job", jobId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiAxios.get<ManualCrawlJobResponse>(
          `/news-manager/crawl/${jobId}`,
          { signal },
        );
        return data;
      } catch {
        throw new Error("Không lấy được trạng thái job thu thập");
      }
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status;
      return currentStatus === "pending" || currentStatus === undefined ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!jobId) return;

    if (isError) {
      setJobId(null);
      setCrawlStatus("error", error?.message ?? "Lỗi không xác định khi poll job thu thập");
      return;
    }

    if (!data) return;

    if (data.status === "done") {
      setDoneResult(data.result ?? null);
      setJobId(null);
      setCrawlStatus("done");
      // Làm mới danh sách raw-articles để dữ liệu vừa crawl xuất hiện.
      void queryClient.invalidateQueries({ queryKey: ["raw-articles"] });
    } else if (data.status === "error") {
      setJobId(null);
      setCrawlStatus("error", data.error ?? "Lỗi không xác định");
    } else if (data.status === "not_found") {
      setJobId(null);
      setCrawlStatus("error", "Không tìm thấy job (có thể server đã khởi động lại)");
    }
  }, [data, isError, error, jobId, queryClient, setCrawlStatus]);

  const startJob = useCallback(
    (newJobId: string) => {
      setDoneResult(null);
      setCrawlStatus("pending");
      setJobId(newJobId);
    },
    [setCrawlStatus],
  );

  return (
    <ManualCrawlJobContext.Provider value={{ startJob, doneResult }}>
      {children}
    </ManualCrawlJobContext.Provider>
  );
};
```

- [ ] **Step 2: Register provider in `AppLayout.tsx`**

Add import (after line 5 `BulkCrawlJobProvider` import):
```tsx
import { ManualCrawlJobProvider } from "../context/ManualCrawlJobContext";
```

Wrap `LayoutContent` with `ManualCrawlJobProvider` inside `BulkCrawlJobProvider` (lines 40-42 become):
```tsx
          <BulkCrawlJobProvider>
            <ManualCrawlJobProvider>
              <LayoutContent />
            </ManualCrawlJobProvider>
          </BulkCrawlJobProvider>
```
(Closing tags updated accordingly at lines 42-43.)

- [ ] **Step 3: Verify typecheck/build**

Run: `cd RealEstateAdminApp && npx tsc --noEmit` (or `npm run build`)
Expected: PASS — no TS errors. (No FE test runner exists in repo — verify via typecheck.)

- [ ] **Step 4: Commit**

```bash
cd D:/Jobs/RealEstateManager
git add RealEstateAdminApp/src/context/ManualCrawlJobContext.tsx \
        RealEstateAdminApp/src/layout/AppLayout.tsx
git commit -m "feat(fe): ManualCrawlJobProvider polling crawl job status

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Frontend — wire `RawArticlesScreen` to async crawl + badge

**Files:**
- Modify: `RealEstateAdminApp/src/screens/RawArticlesScreen.tsx` (imports line 1-12, `crawlMutation` 156-183, `isBusy` 298-304, button 391-398)

**Interfaces:**
- Consumes: `useManualCrawlJob()` from Task 2 (`startJob`, `doneResult`), `useManageWpStatus().crawlStatus`, `parseDateRange(dateRange)` (existing line 39), `getApiErrorMessage`.
- Produces: async crawl button that POSTs, hands jobId to provider, shows "Đang thu thập..." while `crawlStatus === "pending"`, shows success toast with count on `doneResult`.

- [ ] **Step 1: Add imports**

In `RawArticlesScreen.tsx`, after line 4 (`import { useAnalyzeJob } ...`), add:
```tsx
import { useManualCrawlJob } from "../context/ManualCrawlJobContext";
import { useManageWpStatus } from "../context/ManageWpStatusContext";
```

- [ ] **Step 2: Consume provider + status inside component**

Near where `useAnalyzeJob()` is called (find the existing `const { ... } = useAnalyzeJob();` call, add after it):
```tsx
  const { startJob: startManualCrawlJob, doneResult: manualCrawlDoneResult } =
    useManualCrawlJob();
  const { crawlStatus } = useManageWpStatus();
  const isManualCrawlPending = crawlStatus === "pending";
```

- [ ] **Step 3: Add done-result watcher effect**

Add (anywhere after the `setSuccess`/`setError` setters are in scope, e.g. after the `manualCrawlDoneResult` line):
```tsx
  // Khi job crawl nền xong → thông báo count (provider đã invalidate raw-articles).
  useEffect(() => {
    if (!manualCrawlDoneResult) return;
    const count = manualCrawlDoneResult.count;
    if (typeof count === "number" && count > 0) {
      setSuccess(`Thu thập hoàn tất — ${count} bài mới.`);
    } else {
      setSuccess("Quá trình hoàn tất nhưng không tìm thấy bài viết nào mới.");
    }
  }, [manualCrawlDoneResult]);
```
(`useEffect` already imported at line 1.)

- [ ] **Step 4: Rewrite `crawlMutation` to async (replace lines 156-183)**

Replace the whole `crawlMutation` block (lines 156-183) with:
```tsx
  const crawlMutation = useMutation<{ jobId?: string }, Error>({
    mutationFn: async () => {
      try {
        const { data: resData } = await apiAxios.post<{ jobId?: string; message?: string }>(
          "/news-manager/crawl",
          parseDateRange(dateRange),
        );
        return { jobId: resData?.jobId };
      } catch (err) {
        throw new Error(getApiErrorMessage(err, "Lỗi từ máy chủ"));
      }
    },
    onMutate: () => {
      setError("");
      setSuccess("");
      setCrawlStats(null);
    },
    onSuccess: ({ jobId }) => {
      if (!jobId) {
        setError("Không nhận được jobId từ máy chủ");
        return;
      }
      // Chạy nền: submit job rồi trả về ngay, ManualCrawlJobProvider (AppLayout) sẽ
      // tự poll trạng thái và invalidate danh sách khi xong, kể cả khi user đã rời màn.
      startManualCrawlJob(jobId);
    },
    onError: (err) => setError(err.message || "Có lỗi xảy ra khi thu thập dữ liệu."),
  });
```

- [ ] **Step 5: Include manual crawl pending in `isBusy` (lines 298-304)**

Add `isManualCrawlPending ||` to the `isBusy` expression:
```tsx
  const isBusy =
    isFetching ||
    crawlMutation.isPending ||
    isManualCrawlPending ||
    analyzeMutation.isPending ||
    analyzeAllMutation.isPending ||
    isAnalyzeJobRunning ||
    bulkMutation.isPending;
```

- [ ] **Step 6: Update crawl button label/disabled by background status (lines 391-398)**

Replace the crawl `<button>` with:
```tsx
          <button
            onClick={() => crawlMutation.mutate()}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-white transition-all duration-300 bg-brand-500 hover:bg-brand-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            <Play size={20} className={isManualCrawlPending ? "animate-pulse" : ""} />
            <span>{isManualCrawlPending ? "Đang thu thập..." : "Chạy quy trình thu thập"}</span>
          </button>
```
(`isBusy` now includes `isManualCrawlPending`, so the button stays disabled throughout the background run — consistent with the header `CrawlStatusBadge`.)

- [ ] **Step 7: Verify typecheck/build**

Run: `cd RealEstateAdminApp && npx tsc --noEmit` (or `npm run build`)
Expected: PASS — no TS errors. Then manual smoke test: start backend + frontend, click "Chạy quy trình thu thập" → header shows "Đang thu thập..." pill → on done, list reloads + success toast with count; clicking again while pending is disabled.

- [ ] **Step 8: Commit**

```bash
cd D:/Jobs/RealEstateManager
git add RealEstateAdminApp/src/screens/RawArticlesScreen.tsx
git commit -m "feat(fe): wire RawArticlesScreen to async manual crawl + header status

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review (completed)

1. **Spec coverage:** Spec §"Thay đổi Backend" → Task 1 (triggerManualCrawl async, runManualCrawlJob, getManualCrawlJob poll, audit, enum). Spec §"Thay đổi Frontend" → Task 2 (provider + AppLayout) + Task 3 (RawArticlesScreen wiring + button + isBusy + watcher). Spec §"Error handling" → covered: ConflictException (Task 1 test + Task 3 onError), not_found (Task 1 poll test + Task 2 provider), markError via runJob (existing, reused). Spec §"Testing" → Task 1 BE unit tests; FE has no runner → typecheck + manual smoke (documented). All sections mapped.
2. **Placeholder scan:** No TBD/TODO/"add appropriate". All code blocks contain real code. Test code is concrete.
3. **Type consistency:** `ManualCrawlJobResponse.result` shape `{ stats?, count?, filePath? }` matches BE `markDone` result in Task 1 (`{ stats, count, filePath }`) and Task 3 watcher (`manualCrawlDoneResult.count`). `getManualCrawlJob` returns `job` (AnalyzeJob) which FE reads as `ManualCrawlJobResponse` — consistent with existing `BulkCrawlJobContext` convention. `startJob(jobId: string)` signature consistent Task 2 ↔ Task 3.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-01-async-manual-crawl.md`. Per CLAUDE.md, Neptune (architect) sẽ dispatch các coder agent (backend + frontend song song) + qa-agent review sau. Two execution options cho anh:

**1. Subagent-Driven (recommended)** — Neptune dispatch coder-backend-agent (Task 1) + coder-frontend-agent (Task 2, 3) song song, review giữa task, qa-agent review cuối.
**2. Inline Execution** — chạy từng task trong session này.

Anh chọn cách nào ạ?
