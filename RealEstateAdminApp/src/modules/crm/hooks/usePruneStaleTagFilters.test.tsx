import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store';
import { createCrmStore, createSeedDataState, type CrmStore } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { usePruneStaleTagFilters } from './usePruneStaleTagFilters';

/** Máy chủ giả ở mức HTTP: `useCatalogs` THẬT chạy trên React Query thật (không mock hook danh mục). */
const list = vi.fn();
vi.mock('@crm/api/http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@crm/api/http/crmHttp')>()),
  crmHttp: { raw: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), get: vi.fn().mockResolvedValue({}), list: (...args: unknown[]) => list(...args) },
}));

import { useCatalogs } from '@crm/api';
import { CrmApiException } from '@crm/api/http/crmErrors';

const makeStore = (initialTagIds: string[]): CrmStore => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  store.getState().dispatch({ type: 'filters/set', changes: { tagIds: initialTagIds } });
  return store;
};

const getTagIds = (store: CrmStore) => store.getState().state.filters.tagIds;

interface HarnessProps {
  existingTagIds: string[] | null;
}

const Harness = ({ existingTagIds }: HarnessProps) => {
  usePruneStaleTagFilters(existingTagIds);
  return null;
};

const setup = (initialTagIds: string[], props: HarnessProps) => {
  const store = makeStore(initialTagIds);
  const view = (next: HarnessProps) => (
    <MemoryRouter>
      <CrmProvider store={store}>
        <Harness {...next} />
      </CrmProvider>
    </MemoryRouter>
  );
  const utils = render(view(props));
  return { store, rerender: (next: HarnessProps) => utils.rerender(view(next)) };
};

describe('usePruneStaleTagFilters (danh sách id truyền trực tiếp)', () => {
  it('danh sách thẻ đã tải: gỡ id thẻ không còn tồn tại, giữ id còn tồn tại', () => {
    const { store } = setup(['t-golf', 't-gone'], { existingTagIds: ['t-golf', 't-bs'] });
    expect(getTagIds(store)).toEqual(['t-golf']);
  });

  it('chưa có dữ liệu thật (null): KHÔNG gỡ gì', () => {
    const { store } = setup(['t-golf', 't-gone'], { existingTagIds: null });
    expect(getTagIds(store)).toEqual(['t-golf', 't-gone']);
  });

  it('danh sách thẻ nạp lại và một thẻ biến mất: gỡ id đó khỏi bộ lọc', () => {
    const { store, rerender } = setup(['t-golf', 't-bs'], { existingTagIds: ['t-golf', 't-bs'] });
    expect(getTagIds(store)).toEqual(['t-golf', 't-bs']);
    act(() => rerender({ existingTagIds: ['t-golf'] }));
    expect(getTagIds(store)).toEqual(['t-golf']);
  });

  it('chuyển từ chưa có dữ liệu sang có dữ liệu thì mới dọn', () => {
    const { store, rerender } = setup(['t-gone'], { existingTagIds: null });
    expect(getTagIds(store)).toEqual(['t-gone']);
    act(() => rerender({ existingTagIds: ['t-golf'] }));
    expect(getTagIds(store)).toEqual([]);
  });
});

describe('usePruneStaleTagFilters + useCatalogs thật (danh mục tải từng phần)', () => {
  const TAG_PAGE = {
    data: [
      { id: 't-golf', label: 'Golf', category: 'INTEREST', usageCount: 4, color: null },
      { id: 't-bs', label: 'Bác sĩ', category: 'OCCUPATION', usageCount: 7, color: null },
    ],
    meta: { total: 2, page: 1, limit: 100, totalPages: 1 },
  };
  const EMPTY_PAGE = { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } };
  const STATUSES_URL = '/crm/customer-statuses';

  const RealHarness = () => {
    const { existingTagIds, catalogs, isLoading } = useCatalogs();
    usePruneStaleTagFilters(existingTagIds);
    return (
      <>
        <span data-testid="tag-ids">{existingTagIds === null ? 'null' : existingTagIds.join(',')}</span>
        <span data-testid="catalog-tags">{catalogs.tags.length}</span>
        <span data-testid="loading">{String(isLoading)}</span>
      </>
    );
  };

  const renderReal = (store: CrmStore) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CrmProvider store={store}>
            <RealHarness />
          </CrmProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  /** Máy chủ giả: `overrides[url]` quyết định phản hồi riêng cho URL đó; còn lại trả trang rỗng (riêng `/crm/tags` trả TAG_PAGE). */
  const mockServer = (overrides: Record<string, () => Promise<unknown>> = {}) =>
    list.mockImplementation((url: string) => (overrides[url] ? overrides[url]() : Promise.resolve(url === '/crm/tags' ? TAG_PAGE : EMPTY_PAGE)));

  beforeEach(() => {
    list.mockReset();
  });

  it('thẻ đã có dữ liệu nhưng danh mục "trạng thái" chưa tải xong: catalogs.tags vẫn rỗng nhưng bộ lọc thẻ GIỮ NGUYÊN (không bị xóa sạch)', async () => {
    mockServer({ [STATUSES_URL]: () => new Promise(() => undefined) });
    const store = makeStore(['t-golf', 't-bs']);
    renderReal(store);

    await waitFor(() => expect(screen.getByTestId('tag-ids')).toHaveTextContent('t-golf,t-bs'));
    // Đúng tình huống lỗi cũ: catalogs rỗng (còn thiếu danh mục khác) mà vẫn không được dọn nhầm.
    expect(screen.getByTestId('catalog-tags')).toHaveTextContent('0');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(getTagIds(store)).toEqual(['t-golf', 't-bs']);
  });

  it('một danh mục khác (trạng thái) bị lỗi: bộ lọc thẻ giữ nguyên', async () => {
    mockServer({ [STATUSES_URL]: () => Promise.reject(new CrmApiException({ statusCode: 403, errorCode: 'FORBIDDEN', message: 'Không có quyền' })) });
    const store = makeStore(['t-golf']);
    renderReal(store);

    await waitFor(() => expect(screen.getByTestId('tag-ids')).toHaveTextContent('t-golf,t-bs'));
    expect(screen.getByTestId('catalog-tags')).toHaveTextContent('0');
    expect(getTagIds(store)).toEqual(['t-golf']);
  });

  it('chính danh mục thẻ bị lỗi: existingTagIds = null và bộ lọc thẻ (kể cả id cũ) giữ nguyên', async () => {
    mockServer({ '/crm/tags': () => Promise.reject(new CrmApiException({ statusCode: 403, errorCode: 'FORBIDDEN', message: 'Không có quyền' })) });
    const store = makeStore(['t-golf', 't-gone']);
    renderReal(store);

    await waitFor(() => expect(list).toHaveBeenCalledWith('/crm/tags', expect.anything()));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('tag-ids')).toHaveTextContent('null');
    expect(getTagIds(store)).toEqual(['t-golf', 't-gone']);
  });

  it('danh mục thẻ đã tải đủ dữ liệu thật và có id cũ trong bộ lọc: gỡ đúng id cũ', async () => {
    mockServer();
    const store = makeStore(['t-golf', 't-gone']);
    renderReal(store);

    await waitFor(() => expect(getTagIds(store)).toEqual(['t-golf']));
    expect(screen.getByTestId('tag-ids')).toHaveTextContent('t-golf,t-bs');
  });
});
