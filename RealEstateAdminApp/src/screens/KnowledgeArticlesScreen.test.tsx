import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import KnowledgeArticlesScreen from './KnowledgeArticlesScreen';
import { getKnowledgeArticles, KnowledgeArticleState, getWpConfig } from '../api/knowledge-articles.api';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../api/knowledge-articles.api', async () => {
  const actual = await vi.importActual<typeof import('../api/knowledge-articles.api')>('../api/knowledge-articles.api');
  return { ...actual, getKnowledgeArticles: vi.fn(), getWpConfig: vi.fn() };
});

const mockedGetKnowledgeArticles = vi.mocked(getKnowledgeArticles);

const articles = Array.from({ length: 20 }, (_, i) => ({
  _id: `ka-${i + 1}`,
  title: `Knowledge Article ${i + 1}`,
  pipelineState: i % 3 === 0 ? KnowledgeArticleState.PUBLISHED : i % 3 === 1 ? KnowledgeArticleState.READY : KnowledgeArticleState.FAILED,
  categorySlug: i % 2 === 0 ? 'ha-noi' : 'hcm',
  createdAt: `2026-08-${String((i % 9) + 1).padStart(2, '0')}T00:00:00.000Z`,
}));

function pageResponse(page: number, total: number, limit = 20) {
  return {
    data: page === 2 ? articles.slice(0, Math.max(0, total - limit)) : articles.slice(0, Math.min(limit, total)),
    meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <KnowledgeArticlesScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('KnowledgeArticlesScreen', () => {
  beforeEach(() => {
    mockedGetKnowledgeArticles.mockReset();
    mockedGetKnowledgeArticles.mockResolvedValue(pageResponse(1, 30));
  });

  it('renders the page title', async () => {
    renderScreen();
    expect(await screen.findByText('Knowledge Articles')).toBeInTheDocument();
  });

  it('renders articles in the table', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Knowledge Article 1')).toBeInTheDocument();
    });
  });

  it('shows pagination info', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/Hiển thị 1-20 \/ 30 bài viết/)).toBeInTheDocument();
    });
  });

  it('resets to page 1 when status filter changes', async () => {
    mockedGetKnowledgeArticles.mockImplementation(async (_params, _signal) => pageResponse(1, 30));
    renderScreen();

    await screen.findByText('Knowledge Article 1');
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));

    await waitFor(() => {
      expect(mockedGetKnowledgeArticles).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      );
    }, { timeout: 10000 });

    fireEvent.change(screen.getByLabelText('Lọc theo trạng thái:'), { target: { value: 'published' } });

    await waitFor(() => {
      expect(mockedGetKnowledgeArticles).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: 'published' }),
        expect.anything(),
      );
    }, { timeout: 10000 });
  }, 15000);

  it('shows empty state when no articles', async () => {
    mockedGetKnowledgeArticles.mockResolvedValue(pageResponse(1, 0));
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Không có bài viết nào.')).toBeInTheDocument();
    });
  });

  it('renders status badges', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByText('Đã đăng').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Sẵn sàng').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Lỗi').length).toBeGreaterThan(0);
    });
  });
});
