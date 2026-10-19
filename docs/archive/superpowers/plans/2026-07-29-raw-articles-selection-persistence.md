# Raw Articles Selection Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giữ lại toàn bộ selection ở màn RawArticlesScreen khi đổi trang, search, sort, date range, và page size, trong khi vẫn cho phép bulk action an toàn trên nhiều trang.

**Architecture:** Giữ selection ở local state của `RawArticlesScreen`, đổi sang `Set<string>` để đồng bộ với `ManageWpScreen` và làm thao tác merge/remove ổn định hơn. Tách rõ ba luồng: pagination chỉ đổi trang, filter/search/sort chỉ đổi query hiển thị, còn selection chỉ bị clear khi mutation thành công hoặc người dùng chủ động bỏ chọn.

**Tech Stack:** React 19, TypeScript, @tanstack/react-query, Vite, Tailwind CSS, lucide-react.

## Global Constraints

- Bắt buộc tuân thủ SOLID, đặc biệt Single Responsibility: mỗi file/class chỉ làm đúng 1 nhiệm vụ.
- Tuân thủ DRY: tuyệt đối không duplicate code, logic lặp lại phải tách thành Utils/Helpers.
- Component: bắt buộc dùng Functional Component + Hooks. Tên file/Component viết PascalCase.
- Props & Typing: luôn dùng Destructuring cho Props. Mọi Component/Hàm phải khai báo kiểu rõ ràng bằng `interface` hoặc `type`.
- State: đặt tên rõ ràng; kiểu boolean bắt buộc dùng tiền tố `is`, `has`, `should`.
- Quản lý State: chỉ dùng `useState`/`useReducer` cho state cục bộ. State toàn cục hoặc API bắt buộc dùng React Query / Zustand.
- Mọi phương thức phức tạp đều phải có comment tiếng Việt giải thích rõ luồng chạy.
- Tự động dọn dẹp import thừa, biến không sử dụng. Format code bằng Prettier/ESLint.
- UX tối ưu: dùng Skeleton Loading khi fetch data.
- Data Fetching: cấm dùng `useEffect` để gọi API. Bắt buộc dùng React Query để quản lý cache, loading và race condition.
- Response Format: mọi API trả danh sách phải có phân trang chuẩn `{ data: T, meta: { total, page, limit, totalPages } }`.
- Không đổi API backend trong scope này.

---

### Task 1: Switch Raw Articles selection state to Set-based persistence

**Files:**
- Modify: `RealEstateAdminApp/src/screens/RawArticlesScreen.tsx:74-158`

**Interfaces:**
- Consumes: `RawArticle`, `PaginatedResponse<RawArticle>`, `parseDateRange()`, `buildListQuery()`, `useQuery()` page data.
- Produces: `selectedIds: Set<string>`, `isAllOnPageSelected`, `toggleSelect(id)`, `toggleSelectAllOnPage()`, and page/filter reset behavior that preserves selection.

- [ ] **Step 1: Update the failing expectation in the screen logic first**

Change the selection state and reset logic so the screen no longer clears selection on page/filter change:

```ts
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

const filterSignature = `${searchQuery}|${sortOrder}|${startDate ?? ""}|${endDate ?? ""}|${limit}`;
const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
if (prevFilterSignature !== filterSignature) {
  setPrevFilterSignature(filterSignature);
  setPage(1);
}
```

- [ ] **Step 2: Verify the old clear-on-change behavior is gone**

Run the app or a focused typecheck/lint pass and confirm there is no remaining `setSelectedIds([])` tied to page/filter changes.

- [ ] **Step 3: Implement Set helpers for selection toggling**

Replace array-based selection operations with `Set` operations:

```ts
const toggleSelect = (id: string) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
};

const toggleSelectAllOnPage = () => {
  setSelectedIds((prev) => {
    const isAllSelected = currentPageIds.length > 0 && currentPageIds.every((id) => prev.has(id));
    return isAllSelected
      ? new Set([...prev].filter((id) => !currentPageIds.includes(id)))
      : new Set([...prev, ...currentPageIds]);
  });
};
```

- [ ] **Step 4: Verify typing and derived selection state still compile**

Update any call sites that still expect `selectedIds.length` or `selectedIds.includes(...)` to use `selectedIds.size` and `selectedIds.has(...)`.

---

### Task 2: Update bulk action, row checkboxes, and selection summary UI

**Files:**
- Modify: `RealEstateAdminApp/src/screens/RawArticlesScreen.tsx:267-660`

**Interfaces:**
- Consumes: `selectedIds: Set<string>`, `currentPageIds`, `bulkMutation`, `invalidateList()`.
- Produces: checkbox UI and bulk action UI that reflect cross-page selection.

- [ ] **Step 1: Make bulk action read from the Set and keep the same IDs across pages**

Update the bulk mutation trigger to use `Array.from(selectedIds)` and keep the confirmation copy based on `selectedIds.size`:

```ts
const handleApplyBulkAction = () => {
  if (selectedIds.size === 0) return;
  if (bulkAction !== "delete" && bulkAction !== "move_to_main") return;

  const confirmMessage =
    bulkAction === "delete"
      ? `Bạn có chắc chắn muốn xóa ${selectedIds.size} bài viết đã chọn?`
      : `Bạn có chắc chắn muốn di chuyển ${selectedIds.size} bài viết đã chọn sang danh sách chính?`;

  if (!window.confirm(confirmMessage)) return;

  setError("");
  setSuccess("");
  bulkMutation.mutate({ action: bulkAction, ids: Array.from(selectedIds) });
};
```

- [ ] **Step 2: Update header summary text to reflect total selection, not only current page**

Replace copy that says “trên trang này” with a total selection count so users understand the state persists across pages.

```tsx
{selectedIds.size > 0 && (
  <span className="text-theme-xs text-gray-500 dark:text-gray-400">
    Đã chọn {selectedIds.size} bài
  </span>
)}
```

- [ ] **Step 3: Bind row checkboxes and select-all checkbox to Set membership**

Update the row checkbox and select-all checkbox to use `has()` and `currentPageIds.every(...)`:

```tsx
<input
  type="checkbox"
  checked={selectedIds.has(item._id)}
  onChange={() => toggleSelect(item._id)}
/>
```

- [ ] **Step 4: Verify the current-page toggle still only affects the current page**

Manually check that “Chọn tất cả trên trang này” only adds/removes IDs on the visible page and leaves selections from other pages untouched.

---

### Task 3: Keep selection stable across mutation refreshes and prune stale IDs safely

**Files:**
- Modify: `RealEstateAdminApp/src/screens/RawArticlesScreen.tsx:147-290`

**Interfaces:**
- Consumes: `queryClient.invalidateQueries`, `deleteSingleMutation`, `bulkMutation`, `articles`, `rawArticlesPage`.
- Produces: `invalidateList()` and mutation success handlers that clear or prune selection safely.

- [ ] **Step 1: Keep the shared refresh helper clearing selection only after a successful write flow**

Use the shared helper for bulk-success flows so the selection is fully cleared when the selected records are intentionally removed or moved:

```ts
const invalidateList = async () => {
  setSelectedIds(new Set());
  await queryClient.invalidateQueries({ queryKey: ["raw-articles"] });
};
```

- [ ] **Step 2: Keep selection when a mutation fails so the user can retry**

Leave `onError` handlers unchanged except for state type updates; do not clear `selectedIds` on error.

- [ ] **Step 3: Prune only IDs that are known to be deleted by the current action**

When a single-item delete or another targeted write removes a specific record, remove only that record’s ID from `selectedIds`. Do not infer deletions from the current page response, because the screen must preserve cross-page selection.

```ts
setSelectedIds((prev) => {
  const next = new Set(prev);
  next.delete(deletedId);
  return next;
});
```

- [ ] **Step 4: Verify safe pruning does not clear valid cross-page selections**

Confirm the cleanup only removes IDs that were explicitly deleted or moved by the current mutation, and does not touch selections on other pages.

---

### Task 4: Validate the implementation with build, lint, and manual flows

**Files:**
- Modify if needed: `RealEstateAdminApp/src/screens/RawArticlesScreen.tsx`
- Test by running: `RealEstateAdminApp/package.json` scripts

**Interfaces:**
- Consumes: completed selection state, bulk action handlers, pagination, query cache.
- Produces: verified behavior for cross-page selection.

- [ ] **Step 1: Run typecheck/build and lint for the client app**

From `RealEstateAdminApp/`, run:

```bash
npm run build
npm run lint
```

- [ ] **Step 2: Manually verify the cross-page selection flow in the UI**

Check these flows in the browser:

1. Select one article on page 1.
2. Go to page 2.
3. Confirm the original article remains selected.
4. Select another article on page 2.
5. Change search, sort, or date range and confirm both IDs remain in selection.
6. Run a bulk action and confirm selection clears only after success.

- [ ] **Step 3: Verify failure cases keep selection intact**

Force a mutation error if possible and confirm the selection count remains so the user can retry without reselecting.

- [ ] **Step 4: Commit the implementation after review**

```bash
git add RealEstateAdminApp/src/screens/RawArticlesScreen.tsx
git commit -m "feat(raw-articles): persist selection across pagination"
```

## Self-Review Notes

- Spec coverage: page changes, filter changes, selection UI, bulk actions, and post-mutation cleanup are all covered by Tasks 1-4.
- Placeholder scan: no TBD/TODO sections remain.
- Type consistency: the plan uses `Set<string>` consistently and updates every `.length` / `.includes()` call site to `.size` / `.has()`.
- Scope check: the plan stays inside `RawArticlesScreen` and does not introduce a new store or backend change.
