import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateCrm } from '@crm/api';
import { CrmApiException } from '@crm/api/http/crmErrors';
import { HistoryList } from './HistoryList';

const fetchHistories = vi.fn();

vi.mock('@crm/api/http/customerApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/customerApi')>('@crm/api/http/customerApi');
  return { ...real, fetchHistories: (...args: unknown[]) => fetchHistories(...args) };
});

const ENTRY = {
  id: 'h1',
  action: 'STATUS_CHANGED',
  actor: { id: 'u1', displayName: 'Trần B' },
  createdAt: '2026-10-20T03:00:00.000Z',
  source: 'WEB',
  changes: [{ field: 'Tình trạng', from: 'Mới', to: 'Quan tâm' }],
  reason: null,
};

const renderList = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
};

beforeEach(() => {
  fetchHistories.mockReset();
  fetchHistories.mockResolvedValue({ data: [ENTRY], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } });
});

describe('HistoryList thu gọn (PT-021): lazy load lịch sử thay đổi', () => {
  it('mặc định THU GỌN: không vẽ nội dung và KHÔNG gọi API lịch sử khi mới vào màn', async () => {
    renderList(<HistoryList customerId="c1" isCollapsible />);
    const toggle = screen.getByRole('button', { name: /Lịch sử thay đổi/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Đổi tình trạng')).toBeNull();
    // Chờ 1 nhịp để chắc chắn không có lời gọi trễ.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchHistories).not.toHaveBeenCalled();
  });

  it('bấm mở: hiện skeleton rồi gọi API ĐÚNG 1 lần và hiện danh sách', async () => {
    const user = userEvent.setup();
    renderList(<HistoryList customerId="c1" isCollapsible />);
    await user.click(screen.getByRole('button', { name: /Lịch sử thay đổi/ }));
    expect(screen.getByRole('button', { name: /Lịch sử thay đổi/ })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Đổi tình trạng')).toBeInTheDocument();
    expect(screen.getByText('Trần B')).toBeInTheDocument();
    expect(fetchHistories).toHaveBeenCalledTimes(1);
    expect(fetchHistories).toHaveBeenCalledWith('c1', { limit: 50 }, expect.anything());
  });

  it('đóng rồi mở lại: giữ cache, KHÔNG gọi API lần 2 và danh sách hiện ngay', async () => {
    const user = userEvent.setup();
    renderList(<HistoryList customerId="c1" isCollapsible />);
    const toggle = screen.getByRole('button', { name: /Lịch sử thay đổi/ });
    await user.click(toggle);
    await screen.findByText('Đổi tình trạng');
    await user.click(toggle);
    expect(screen.queryByText('Đổi tình trạng')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByText('Đổi tình trạng')).toBeInTheDocument();
    expect(fetchHistories).toHaveBeenCalledTimes(1);
  });

  it('đóng, có thao tác GHI (invalidateCrm) rồi mở lại: tải lại và hiện lịch sử MỚI (cache 5 phút không làm lịch sử cũ sau khi ghi)', async () => {
    const user = userEvent.setup();
    const { client } = renderList(<HistoryList customerId="c1" isCollapsible />);
    const toggle = screen.getByRole('button', { name: /Lịch sử thay đổi/ });
    await user.click(toggle);
    await screen.findByText('Đổi tình trạng');
    await user.click(toggle);
    // Lúc đang đóng, lớp ghi (`write`) làm mất hiệu lực toàn bộ dữ liệu CRM.
    fetchHistories.mockResolvedValue({ data: [{ ...ENTRY, id: 'h2', action: 'CARE_LOG_CREATED', changes: [] }], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } });
    await invalidateCrm(client);
    expect(fetchHistories).toHaveBeenCalledTimes(1); // đang đóng: chưa gọi mạng
    await user.click(toggle);
    expect(await screen.findByText('Ghi nhật ký')).toBeInTheDocument();
    expect(fetchHistories).toHaveBeenCalledTimes(2);
  });

  it('lỗi tải: báo lỗi + nút "Thử lại" gọi lại API', async () => {
    // 403: lỗi 4xx là kết quả cuối, không bị React Query thử lại tự động (chỉ lỗi mạng/5xx mới thử lại).
    fetchHistories.mockRejectedValueOnce(new CrmApiException({ statusCode: 403, errorCode: 'FORBIDDEN', message: 'Không có quyền' }));
    const user = userEvent.setup();
    renderList(<HistoryList customerId="c1" isCollapsible />);
    await user.click(screen.getByRole('button', { name: /Lịch sử thay đổi/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được lịch sử thay đổi.');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đổi tình trạng')).toBeInTheDocument();
    await waitFor(() => expect(fetchHistories).toHaveBeenCalledTimes(2));
  });

  it('không thu gọn (desktop, đã nằm sau tab): luôn mở và gọi API ngay khi được dựng', async () => {
    renderList(<HistoryList customerId="c1" />);
    expect(await screen.findByText('Đổi tình trạng')).toBeInTheDocument();
    expect(fetchHistories).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Lịch sử thay đổi/ })).toBeNull();
  });

  it('thu gọn mà chưa có lịch sử: sau khi mở hiện câu "Chưa có thay đổi nào được ghi lại."', async () => {
    fetchHistories.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 1 } });
    const user = userEvent.setup();
    renderList(<HistoryList customerId="c1" isCollapsible />);
    await user.click(screen.getByRole('button', { name: /Lịch sử thay đổi/ }));
    expect(await screen.findByText('Chưa có thay đổi nào được ghi lại.')).toBeInTheDocument();
  });
});

describe('HistoryList: đổi tình trạng tự động theo tiến độ (PT-023)', () => {
  it('thay đổi statusAutoSource hiện chip "Tự động theo tiến độ", KHÔNG lộ tên field kỹ thuật, vẫn giữ dòng đổi tình trạng', async () => {
    fetchHistories.mockResolvedValue({
      data: [{ ...ENTRY, changes: [{ field: 'Tình trạng', from: 'Quan tâm', to: 'Net' }, { field: 'statusAutoSource', from: '', to: 'CRITERIA_PROGRESS' }] }],
      meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
    });
    renderList(<HistoryList customerId="c1" />);
    expect(await screen.findByText('Tự động theo tiến độ')).toBeInTheDocument();
    expect(screen.queryByText(/statusAutoSource/)).toBeNull();
    expect(screen.queryByText(/CRITERIA_PROGRESS/)).toBeNull();
    expect(screen.getByText('Net')).toBeInTheDocument();
  });

  it('bản ghi đổi tay (không có statusAutoSource): không hiện chip tự động', async () => {
    renderList(<HistoryList customerId="c1" />);
    expect(await screen.findByText('Đổi tình trạng')).toBeInTheDocument();
    expect(screen.queryByText('Tự động theo tiến độ')).toBeNull();
  });
});
