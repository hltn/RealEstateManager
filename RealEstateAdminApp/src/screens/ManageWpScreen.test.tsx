import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// Màn ManageWp render nặng (bảng + nhiều control); khi máy tải hoặc chạy song song cả suite thì
// timeout mặc định của findBy/waitFor (1s) gây flaky. Timeout của test (15s) cấu hình ở vite.config.ts.
configure({ asyncUtilTimeout: 8_000 });

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

const HISTORY_ENDPOINT = '/news-manager/articles/market-analysis-history';

function renderHistoryScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ManageWpScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Mock riêng endpoint lịch sử; các endpoint khác trả data rỗng. */
function mockHistoryEndpoint(handler: () => Promise<unknown>) {
  vi.mocked(apiAxios.get).mockImplementation(((url: string) =>
    url.includes(HISTORY_ENDPOINT) ? handler() : Promise.resolve({ data: null })) as typeof apiAxios.get);
}

// Modal lịch sử chỉ mount nội dung sau khi bấm nút "Xem lịch sử phân tích" trong header
// (query `enabled: isOpen`), nên mọi test phải mở modal bằng click thay vì chỉ render màn hình.
async function openHistoryModal() {
  renderHistoryScreen();
  fireEvent.click(await screen.findByRole('button', { name: /xem lịch sử phân tích/i }));
}

describe('ManageWpScreen AnalysisHistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchPaginated.mockReset();
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, 30));
    mockHistoryEndpoint(() => Promise.resolve({ data: { data: mockHistoryData } }));
  });

  it('không render modal và không gọi API lịch sử khi chưa bấm nút mở', async () => {
    renderHistoryScreen();
    await screen.findByText('Bài viết 21');

    expect(screen.queryByText('Lịch sử phân tích thị trường')).not.toBeInTheDocument();
    expect(vi.mocked(apiAxios.get)).not.toHaveBeenCalledWith(HISTORY_ENDPOINT, expect.anything());
  });

  it('bấm nút mở thì hiển thị modal lịch sử', async () => {
    await openHistoryModal();

    expect(await screen.findByText('Lịch sử phân tích thị trường')).toBeInTheDocument();
  });

  it('hiển thị trạng thái đang tải trong lúc fetch lịch sử', async () => {
    mockHistoryEndpoint(() => new Promise(() => {}));
    await openHistoryModal();

    expect(await screen.findByRole('status', { name: /đang tải lịch sử phân tích/i })).toBeInTheDocument();
  });

  it('hiển thị "Chưa có lịch sử phân tích." khi API trả mảng rỗng', async () => {
    mockHistoryEndpoint(() => Promise.resolve({ data: { data: [] } }));
    await openHistoryModal();

    expect(await screen.findByText('Chưa có lịch sử phân tích.')).toBeInTheDocument();
  });

  it('render đủ các mục lịch sử kèm số bài viết nguồn', async () => {
    await openHistoryModal();

    const items = await screen.findAllByText(/^Phân tích lúc /);
    expect(items).toHaveLength(mockHistoryData.length);
    // Mỗi mock có đúng 2 articleIds
    expect(screen.getAllByText('Từ 2 bài viết')).toHaveLength(mockHistoryData.length);
    expect(screen.getAllByRole('button', { name: /xem chi tiết/i })).toHaveLength(mockHistoryData.length);
  });

  it('hiển thị lỗi (role=alert) và cho phép thử lại khi API lịch sử thất bại', async () => {
    let shouldFail = true;
    mockHistoryEndpoint(() =>
      shouldFail ? Promise.reject(new Error('API Error')) : Promise.resolve({ data: { data: mockHistoryData } }),
    );
    await openHistoryModal();

    expect(await screen.findByRole('alert')).toHaveTextContent(/không thể tải lịch sử phân tích/i);
    // Không được báo nhầm là "chưa có lịch sử" khi thực chất là lỗi
    expect(screen.queryByText('Chưa có lịch sử phân tích.')).not.toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findAllByText(/^Phân tích lúc /)).toHaveLength(mockHistoryData.length);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('bấm "Xem chi tiết" mở modal kết quả với nội dung của đúng mục', async () => {
    await openHistoryModal();

    const detailButtons = await screen.findAllByRole('button', { name: /xem chi tiết/i });
    fireEvent.click(detailButtons[1]);

    expect(await screen.findByText('Kết quả Phân tích Thị trường')).toBeInTheDocument();
    expect(screen.getByText(/Nội dung phân tích thị trường 2\.\.\./)).toBeInTheDocument();
  });

  it('vẫn render đủ mục (key dự phòng theo index) khi một mục thiếu _id', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const incompleteData = mockHistoryData.map((item, index) => ({
      ...item,
      _id: index === 0 ? undefined : item._id,
    }));
    mockHistoryEndpoint(() => Promise.resolve({ data: { data: incompleteData } }));
    await openHistoryModal();

    expect(await screen.findAllByText(/^Phân tích lúc /)).toHaveLength(incompleteData.length);
    // Không có cảnh báo React về key thiếu/trùng
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('unique "key"'))).toBe(false);
    errorSpy.mockRestore();
  });

  // Hồi quy: trước đây modal dùng chung key ['market-analysis-history'] với màn Phân tích thị trường
  // (dạng InfiniteData) nhưng lưu mảng phẳng -> hai màn đè cache của nhau.
  it('không ghi đè cache InfiniteData ["market-analysis-history"] của màn Workflow khi mở modal', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const workflowCache = {
      pages: [{ data: [{ _id: 'wf-1', content: 'c', articleIds: [], createdAt: '2026-08-01T00:00:00.000Z' }], meta: { hasMore: false, nextCursor: null } }],
      pageParams: [null],
    };
    client.setQueryData(['market-analysis-history'], workflowCache);

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ManageWpScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /xem lịch sử phân tích/i }));

    expect(await screen.findAllByText(/^Phân tích lúc /)).toHaveLength(mockHistoryData.length);
    // Cache của màn Workflow giữ nguyên (cùng tham chiếu, vẫn là InfiniteData) ...
    expect(client.getQueryData(['market-analysis-history'])).toBe(workflowCache);
    // ... còn dữ liệu của modal nằm ở key riêng, dạng mảng phẳng.
    expect(client.getQueryData(['market-analysis-history', 'modal-list'])).toEqual(mockHistoryData);
  });
});
