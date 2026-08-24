# Content Dedup — QA Review Report

> Date: 2026-08-14
> Reviewer: qa-agent
> Branches reviewed: t_fccb88c8 (BE), t_e3246daf (FE)
> Design spec: docs/CONTENT_DEDUP_DESIGN.md

---

## Test Results

| Scope | Suites | Tests | Status |
|-------|--------|-------|--------|
| Backend (full) | 48 | 612 | ALL PASS |
| Frontend (full) | 4 | 31 | ALL PASS |
| **Dedup-specific** | | | |
| cosine-similarity.util.spec | 1 | 8 | PASS |
| embedding.service.spec | 1 | 16 | PASS |
| news-article.service.spec (dedup portion) | 1 | 12 | PASS |
| RawArticlesScreen.test | 1 | 8 | PASS |

No regressions detected.

---

## Findings

### MAJOR

#### M1: retroactiveDedupScan is a no-op
- **File**: `news-article.service.ts` — `retroactiveDedupScan()` method
- **Rule**: Feature correctness / spec compliance
- **Description**: The `updateOne` call has an empty `$set` object:
  ```typescript
  await this.newsArticleModel.updateOne(
    { _id: current._id },
    { $set: { /* Store dedup info... */ } },  // EMPTY — nothing written
  );
  ```
  The method detects duplicates but never marks them. The endpoint
  `POST /articles/retroactive-dedup-scan` returns `{ duplicatesFound: N }`
  but performs no actual database writes.
- **Impact**: Admin runs the scan, sees "Duplicates found: 5" in the response,
  but nothing changed in the database. Misleading.
- **Fix**: Either (a) implement the marking logic (which requires adding
  `isDuplicate`/`duplicateOf` fields to NewsArticle — design spec explicitly
  says not to), or (b) remove/disable the endpoint until the design decision
  is resolved.

#### M2: No test for batch dedup in saveArticles
- **File**: `news-article.service.spec.ts`
- **Rule**: Test coverage — critical edge case
- **Description**: The design spec (Section 8.2) specifically highlights
  same-batch dedup as an important scenario. There's a unit test for
  `checkDuplicate` with `batchBuffer`, but no integration-level test where
  two articles in the same `saveArticles()` call have identical embeddings.
- **Fix**: Add test: submit 2 articles with identical embeddings in one
  `saveArticles()` call, assert the first is saved and the second is marked
  duplicate via `batchEmbeddings`.

#### M3: No test for retroactiveDedupScan
- **File**: `news-article.service.spec.ts`
- **Rule**: Test coverage
- **Description**: The method exists and is exposed via endpoint but has
  zero test coverage. Combined with M1 (the method is a no-op), this means
  there's no safety net.
- **Fix**: Add at least one test verifying the method runs without error.
  After M1 is fixed, add tests for the actual dedup behavior.

---

### MINOR

#### m4: Missing test for modal error state (FE)
- **File**: `RawArticlesScreen.test.tsx`
- **Rule**: Test coverage — error path
- **Description**: No test for when the original article API call fails
  in the "Xem bài gốc" modal. The modal shows "Không tìm thấy bài gốc."
  but this path is untested.
- **Fix**: Add test: mock API to reject, verify fallback text appears.

#### m5: Missing test for override mutation error (FE)
- **File**: `RawArticlesScreen.test.tsx`
- **Rule**: Test coverage — error path
- **Description**: No test for when `PATCH override-duplicate` fails.
  The `onError` handler sets `setError(...)` but this isn't verified.
- **Fix**: Add test: mock patch to reject, verify error banner appears.

#### m6: Missing test for override mutation loading state (FE)
- **File**: `RawArticlesScreen.test.tsx`
- **Rule**: Test coverage — UI state
- **Description**: The override button shows "Đang xử lý..." during
  `isPending` but this isn't tested.
- **Fix**: Add test: mock patch to never resolve, verify loading text.

#### m7: No input validation on backfillEmbeddings batchSize
- **File**: `news-fire-crawl-manager.controller.ts` (backfillEmbeddings)
- **Rule**: Input validation
- **Description**: `batchSize` from request body is passed directly to
  service. No DTO validation — negative, zero, or extremely large values
  are accepted.
- **Fix**: Add DTO with `@IsOptional() @IsInt() @Min(1) @Max(500)`.

#### m8: overrideDuplicate doesn't check current state
- **File**: `news-fire-crawl-manager.controller.ts` (overrideDuplicate)
- **Rule**: Input validation
- **Description**: Endpoint blindly sets `isDuplicate: false` without
  checking if the article was actually a duplicate. Could be used to
  modify any raw article's dedup fields.
- **Fix**: Add check: only override if `article.isDuplicate === true`,
  return 400 if not currently a duplicate.

---

## Code Quality Assessment

### Backend
| Area | Status | Notes |
|------|--------|-------|
| Schema design (RawArticle) | PASS | All fields per spec, correct indexes |
| Schema design (NewsArticle) | PASS | Content/embedding fields per spec, correct indexes |
| EmbeddingService | PASS | ConfigService for env vars, proper error handling |
| cosineSimilarity | PASS | Matches spec, edge cases handled |
| dedup logic in saveArticles | PASS | Graceful degradation, batch buffer, RawArticle guard |
| backfillEmbeddings | PASS | Rate limiting, failure counting |
| retroactiveDedupScan | FAIL | Empty updateOne — no-op (M1) |
| REST endpoints | PASS | Proper methods (PATCH/POST), response format `{message, data}` |
| Module wiring | PASS | EmbeddingService registered, all schemas in MongooseModule |

### Frontend
| Area | Status | Notes |
|------|--------|-------|
| RawArticle interface | PASS | Dedup fields added |
| Status tags | PASS | Correct colors: red/green/gray |
| Modal (Xem bài gốc) | PASS | Loading state, data display, close on backdrop |
| Override button | PASS | Correct API call, list refresh, error handling |
| React Query usage | PASS | useQuery for article detail, useMutation for override |
| State management | PASS | viewingArticleId + viewingRawArticleId tracked separately |

---

## Pre-Merge Checklist

- [ ] Fix M1: Resolve retroactiveDedupScan no-op (implement or remove)
- [ ] Fix M2: Add batch dedup integration test
- [ ] Fix M3: Add retroactiveDedupScan test
- [ ] Commit changes from BE worktree (t_fccb88c8)
- [ ] Commit changes from FE worktree (t_e3246daf)
- [ ] Merge into QA branch for final verification
- [ ] (Optional) m4-m8: Add missing FE tests and input validation
