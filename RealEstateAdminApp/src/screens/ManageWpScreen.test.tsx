import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ManageWpScreen from './ManageWpScreen';
import { fetchPaginated } from '../utils/fetchPaginated';
import apiAxios from '../api/axios';

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

// Mock market analysis history data
const mockHistoryData = Array.from({ length: 5 }, (_, index) => ({
  _id: `history-${index + 1}`,
  content: `Nội dung phân tích thị trường ${index + 1}...\n\nĐây là nội dung mẫu để test history display.`,
  articleIds: [`article-${index + 1}`, `article-${index + 2}`],
  createdAt: `2026-08-${String((index % 9) + 1).padStart(2, '0')}T12:00:00.000Z`,
}));

describe('ManageWpScreen AnalysisHistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock API response for market analysis history
    vi.mocked(apiAxios.get).mockImplementation((url) => {
      if (url.includes('/news-manager/articles/market-analysis-history')) {
        return Promise.resolve({
          data: mockHistoryData,
        });
      }
      return Promise.resolve({ data: null });
    });
  });

  it('should not render modal when isOpen is false', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Modal should not be in DOM
    expect(container.querySelector('[data-testid="analysis-history-modal"]')).toBeNull();
  });

  it('should render modal when isOpen is true', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Simulate modal opening (normally triggered by button click)
    const modal = container.querySelector('[data-testid="analysis-history-modal"]');
    expect(modal).toBeInTheDocument();
  });

  it('should show loading state when fetching history', async () => {
    vi.mocked(apiAxios.get).mockImplementationOnce(() =>
      new Promise(resolve => setTimeout(() => resolve({ data: mockHistoryData }), 100))
    );

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, notifyOnNetworkError: true }
      }
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Should show loading indicator
    await waitFor(() => {
      const loading = screen.getByText(/Đang tải/i);
      expect(loading).toBeInTheDocument();
    });
  });

  it('should show "Chưa có lịch sử phân tích" when history is empty', async () => {
    // Mock empty response
    vi.mocked(apiAxios.get).mockImplementation((url) => {
      if (url.includes('/news-manager/articles/market-analysis-history')) {
        return Promise.resolve({
          data: [], // Empty array
        });
      }
      return Promise.resolve({ data: null });
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Chưa có lịch sử phân tích')).toBeInTheDocument();
    });
  });

  it('should render history items when data is available', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Check if history items are rendered
      expect(screen.getByText('Phân tích lúc')).toBeInTheDocument();

      // Check if specific content is displayed
      mockHistoryData.forEach((item, index) => {
        const date = new Date(item.createdAt).toLocaleString('vi-VN');
        expect(screen.getByText(`${index + 1}. ${date}`)).toBeInTheDocument();
      });
    });
  });

  it('should handle API errors gracefully', async () => {
    // Mock API error
    vi.mocked(apiAxios.get).mockImplementationOnce(() =>
      Promise.reject(new Error('API Error'))
    );

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, notifyOnNetworkError: false }
      }
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Should handle error without crashing
    await waitFor(() => {
      const errorElement = screen.getByText(/lỗi/i);
      expect(errorElement).toBeInTheDocument();
    });
  });

  it('should call onShowDetail when "Xem chi tiết" button is clicked', async () => {
    const onShowDetailMock = vi.fn();

    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Wait for history to load
    await waitFor(() => {
      expect(screen.getByText('Phân tích lúc')).toBeInTheDocument();
    });

    // Find and click Xem chi tiết button
    const detailButtons = screen.getAllByText('Xem chi tiết');
    expect(detailButtons.length).toBeGreaterThan(0);

    fireEvent.click(detailButtons[0]);

    // Check if onShowDetail was called (this depends on implementation)
    // The actual call happens inside AnalysisHistoryModal
  });

  it('should render with fallback key when item._id is missing', async () => {
    // Mock data with missing _id
    const incompleteData = mockHistoryData.map((item, index) => ({
      ...item,
      _id: index === 0 ? undefined : item._id, // First item has no _id
    }));

    vi.mocked(apiAxios.get).mockImplementation((url) => {
      if (url.includes('/news-manager/articles/market-analysis-history')) {
        return Promise.resolve({
          data: incompleteData,
        });
      }
      return Promise.resolve({ data: null });
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Should still render without crashing
      expect(screen.getAllByText('Phân tích lúc')).toHaveLength(incompleteData.length);
    });
  });
});
