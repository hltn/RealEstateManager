import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import KnowledgeConfigScreen from './KnowledgeConfigScreen';
import {
  getWpConfig,
  getAiWritingConfig,
  getAiImageConfig,
  testImageGeneration,
} from '../api/knowledge-articles.api';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../api/knowledge-articles.api', async () => {
  const actual = await vi.importActual<typeof import('../api/knowledge-articles.api')>('../api/knowledge-articles.api');
  return {
    ...actual,
    getWpConfig: vi.fn(),
    getAiWritingConfig: vi.fn(),
    getAiImageConfig: vi.fn(),
    verifyWpConnection: vi.fn(),
    testImageGeneration: vi.fn(),
  };
});

const mockedGetWpConfig = vi.mocked(getWpConfig);
const mockedGetAiWritingConfig = vi.mocked(getAiWritingConfig);
const mockedGetAiImageConfig = vi.mocked(getAiImageConfig);
const mockedTestImageGeneration = vi.mocked(testImageGeneration);

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <KnowledgeConfigScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('KnowledgeConfigScreen', () => {
  beforeEach(() => {
    mockedGetWpConfig.mockReset();
    mockedGetAiWritingConfig.mockReset();
    mockedGetAiImageConfig.mockReset();
    mockedTestImageGeneration.mockReset();
    mockedGetWpConfig.mockResolvedValue({
      siteUrl: 'https://example.com',
      username: 'admin',
      appPassword: '***',
      defaultCategoryId: 15,
      categoryMapping: [{ slug: 'ha-noi', wpCategoryId: 16, wpCategoryName: 'BĐS Hà Nội' }],
      defaultTagIds: [1],
      tagMapping: [{ name: 'chung cư', wpTagId: 1 }],
    });
    mockedGetAiWritingConfig.mockResolvedValue({
      promptTemplate: 'Write about {{topic}}',
      model: 'gemini-2.5-flash',
      provider: 'OpenRouter',
      maxTokens: 4096,
      temperature: 0.7,
      topics: [{ slug: 'ha-noi', name: 'Hà Nội', description: 'Test' }],
      articlesPerBatch: 3,
    });
    mockedGetAiImageConfig.mockResolvedValue({
      enabled: true,
      promptTemplate: 'Image of {{title}}',
      model: 'sdxl',
      provider: 'ComfyUI',
      width: 1024,
      height: 1024,
      style: 'realistic',
    });
  });

  it('renders the page title', async () => {
    renderScreen();
    expect(await screen.findByText(/Knowledge Articles — Cấu hình/)).toBeInTheDocument();
  });

  it('shows the WP Connection tab by default', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('WordPress Site URL')).toBeInTheDocument();
    });
  });

  it('renders all three tabs', async () => {
    renderScreen();
    expect(await screen.findByText('WordPress Connection')).toBeInTheDocument();
    expect(screen.getByText('AI Writing')).toBeInTheDocument();
    expect(screen.getByText('AI Image Generation')).toBeInTheDocument();
  });

  it('switches to AI Writing tab', async () => {
    renderScreen();
    await screen.findByText('WordPress Site URL');
    const aiWritingTab = screen.getByText('AI Writing');
    aiWritingTab.click();
    await waitFor(() => {
      expect(screen.getByText('Prompt Template')).toBeInTheDocument();
    });
  });

  it('switches to AI Image tab', async () => {
    renderScreen();
    await screen.findByText('WordPress Site URL');
    const aiImageTab = screen.getByText('AI Image Generation');
    aiImageTab.click();
    await waitFor(() => {
      expect(screen.getByText('Kích hoạt sinh ảnh')).toBeInTheDocument();
    });
  });

  it('loads WP config values into form', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('admin')).toBeInTheDocument();
    });
  });

  it('shows verify connection button', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Kiểm tra kết nối')).toBeInTheDocument();
    });
  });

  it('shows test image generation button on AI Image tab', async () => {
    renderScreen();
    const aiImageTab = screen.getByText('AI Image Generation');
    fireEvent.click(aiImageTab);
    await waitFor(() => {
      expect(screen.getByText('Tạo ảnh mẫu')).toBeInTheDocument();
    });
  });
});
