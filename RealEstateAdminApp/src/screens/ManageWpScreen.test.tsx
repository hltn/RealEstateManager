import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ManageWpScreen from './ManageWpScreen';
import { fetchPaginated } from '../utils/fetchPaginated';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../utils/fetchPaginated', async () => {
  const actual = await vi.importActual<typeof import('../utils/fetchPaginated')>('../utils/fetchPaginated');
  return { ...actual, fetchPaginated: vi.fn() };
});
vi.mock('../context/ManageWpStatusContext', () => ({
  useManageWpStatus: () => ({ crawlStatus: 'idle', setCrawlStatus: vi.fn(), setMarketAnalysisStatus: vi.fn() }),
}));
vi.mock('../context/MarketAnalysisJobContext', () => ({
  useMarketAnalysisJob: () => ({
    status: 'idle', errorMessage: null, resultContent: null, startJob: vi.fn(), clearResult: vi.fn(),
  }),
}));
vi.mock('../context/BulkCrawlJobContext', () => ({ useBulkCrawlJob: () => ({ startJob: vi.fn() }) }));
vi.mock('../hooks/useHeaderStatusReset', () => ({ useHeaderStatusReset: () => vi.fn() }));

const mockedFetchPaginated = vi.mocked(fetchPaginated);
const articles = Array.from({ length: 20 }, (_, index) => ({
  _id: `article-${index + 21}`,
  title: `Bài viết ${index + 21}`,
  source: 'Nguồn tin',
  createdAt: `2026-08-${String((index % 9) + 1).padStart(2, '0')}T00:00:00.000Z`,
}));

function pageResponse(page: number, total: number, limit = 20) {
  return {
    data: page === 2 ? articles.slice(0, Math.max(0, total - limit)) : articles.slice(0, Math.min(limit, total)),
    meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ManageWpScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ManageWpScreen pagination', () => {
  beforeEach(() => {
    mockedFetchPaginated.mockReset();
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, 30));
  });

  it('keeps continuous STT on page 2 and sends status/date filters to the server', async () => {
    mockedFetchPaginated.mockImplementation(async (_url, page) => pageResponse(page, 30));
    renderScreen();

    await screen.findByText('Bài viết 21');
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));

    await waitFor(() => expect(mockedFetchPaginated).toHaveBeenLastCalledWith(
      expect.stringContaining('page=2'), 2, 20, expect.anything(),
    ));
    await waitFor(() => {
      expect(screen.getByText('Hiển thị 21-30 / 30 bài viết · Trang 2/2')).toBeInTheDocument();
    });
    expect(screen.getAllByText('21').some((element) => element.tagName === 'TD')).toBe(true);

    fireEvent.change(screen.getByLabelText('Lọc theo trạng thái'), { target: { value: 'POSTED_WP' } });
    await waitFor(() => expect(mockedFetchPaginated).toHaveBeenLastCalledWith(
      expect.stringContaining('status=POSTED_WP'), 1, 20, expect.anything(),
    ));
  });

  it('shows the first-page summary and never renders an invalid range for zero results', async () => {
    renderScreen();

        expect(await screen.findByText('Hiển thị 1-20 / 30 bài viết · Trang 1/2')).toBeInTheDocument();

    mockedFetchPaginated.mockResolvedValue(pageResponse(1, 0));
    fireEvent.change(screen.getByLabelText('Lọc theo trạng thái'), { target: { value: 'ERROR' } });

    expect(await screen.findByText('Hiển thị 0 / 0 bài viết · Trang 0/0')).toBeInTheDocument();
    expect(screen.queryByText(/Hiển thị -/)).not.toBeInTheDocument();
  });

  it('resets to page 1 and clears selection when the server-side status filter changes', async () => {
    mockedFetchPaginated.mockImplementation(async (_url, page, limit) => pageResponse(page, 30, limit));
    renderScreen();

    await screen.findByText('Bài viết 21');
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));
    await screen.findAllByText('Hiển thị 21-30 / 30 bài viết · Trang 2/2');
    fireEvent.click(screen.getByLabelText('Chọn bài viết Bài viết 21'));
    expect(screen.getByLabelText('Chọn bài viết Bài viết 21')).toBeChecked();

    fireEvent.change(screen.getByLabelText('Lọc theo trạng thái'), { target: { value: 'CRAWLED' } });
        expect(await screen.findByText('Hiển thị 1-20 / 30 bài viết · Trang 1/2')).toBeInTheDocument();
    expect(screen.getByLabelText('Chọn bài viết Bài viết 21')).not.toBeChecked();
  });
});
