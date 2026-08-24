import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import KnowledgeCronScreen from './KnowledgeCronScreen';
import {
  getKnowledgeCronConfig,
  getPipelineLogs,
} from '../api/knowledge-articles.api';
import { PipelineRunStatus } from '../api/knowledge-articles.api';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../api/knowledge-articles.api', async () => {
  const actual = await vi.importActual<typeof import('../api/knowledge-articles.api')>('../api/knowledge-articles.api');
  return {
    ...actual,
    getKnowledgeCronConfig: vi.fn(),
    getPipelineLogs: vi.fn(),
    parseNlSchedule: vi.fn(),
    previewSchedule: vi.fn(),
    activateSchedule: vi.fn(),
    testRunPipeline: vi.fn(),
    startPipeline: vi.fn(),
    getPipelineLogDetail: vi.fn(),
  };
});

const mockedGetCronConfig = vi.mocked(getKnowledgeCronConfig);
const mockedGetPipelineLogs = vi.mocked(getPipelineLogs);

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <KnowledgeCronScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('KnowledgeCronScreen', () => {
  beforeEach(() => {
    mockedGetCronConfig.mockReset();
    mockedGetPipelineLogs.mockReset();
    mockedGetCronConfig.mockResolvedValue({
      isActive: true,
      frequency: '0 8 * * 1-5',
      nlDescription: 'Mỗi ngày 8h từ thứ 2 đến thứ 6',
      parsedCron: '0 8 * * 1-5',
      lastRunAt: '2026-08-15T08:00:00.000Z',
      nextRunAt: '2026-08-16T08:00:00.000Z',
    });
    mockedGetPipelineLogs.mockResolvedValue({
      data: [
        {
          _id: 'log-1',
          batchId: 'batch-001',
          categorySlug: 'ha-noi',
          source: 'cron',
          status: PipelineRunStatus.COMPLETED,
          totalArticles: 3,
          publishedCount: 3,
          failedCount: 0,
          readyCount: 0,
          articleResults: [],
          steps: [],
          totalDuration: 120000,
          errorSummary: null,
          createdAt: '2026-08-15T08:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    });
  });

  it('renders the page title', async () => {
    renderScreen();
    expect(await screen.findByText(/Knowledge Cron & Pipeline Logs/)).toBeInTheDocument();
  });

  it('shows current schedule when cron config is loaded', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('0 8 * * 1-5')).toBeInTheDocument();
    });
  });

  it('shows NL description', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('"Mỗi ngày 8h từ thứ 2 đến thứ 6"')).toBeInTheDocument();
    });
  });

  it('shows active status', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();
    });
  });

  it('shows the NL input textarea', async () => {
    renderScreen();
    expect(await screen.findByPlaceholderText(/Mỗi ngày 8h sáng/)).toBeInTheDocument();
  });

  it('shows preview button', async () => {
    renderScreen();
    expect(await screen.findByText('Preview')).toBeInTheDocument();
  });

  it('shows test run button', async () => {
    renderScreen();
    expect(await screen.findByText('Chạy test (1 bài)')).toBeInTheDocument();
  });

  it('renders pipeline logs table', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('batch-001')).toBeInTheDocument();
      expect(screen.getByText('Pipeline Logs')).toBeInTheDocument();
    });
  });

  it('shows log status badge', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByText('Hoàn thành').length).toBeGreaterThan(0);
    });
  });
});
