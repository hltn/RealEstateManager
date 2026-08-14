import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import RawArticlesScreen from "./RawArticlesScreen";
import { fetchPaginated } from "../utils/fetchPaginated";
import apiAxios from "../api/axios";

vi.mock("../api/axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("../utils/fetchPaginated", async () => {
  const actual = await vi.importActual<
    typeof import("../utils/fetchPaginated")
  >("../utils/fetchPaginated");
  return { ...actual, fetchPaginated: vi.fn() };
});
vi.mock("../context/AnalyzeJobContext", () => ({
  useAnalyzeJob: () => ({
    status: "idle",
    startJob: vi.fn(),
  }),
}));
vi.mock("../context/ManualCrawlJobContext", () => ({
  useManualCrawlJob: () => ({
    startJob: vi.fn(),
    doneResult: null,
  }),
}));
vi.mock("../context/ManageWpStatusContext", () => ({
  useManageWpStatus: () => ({
    crawlStatus: "idle",
    crawlError: null,
  }),
}));
vi.mock("../hooks/useHeaderStatusReset", () => ({
  useHeaderStatusReset: () => vi.fn(),
}));
vi.mock("../components/ui/DatePicker", () => ({
  DatePicker: ({ placeholder }: { placeholder?: string }) => (
    <input placeholder={placeholder} />
  ),
}));

const mockedFetchPaginated = vi.mocked(fetchPaginated);
const mockedApiAxios = vi.mocked(apiAxios);

function makeRawArticle(overrides: Record<string, any> = {}) {
  return {
    _id: `raw-${Math.random().toString(36).slice(2, 8)}`,
    title: "Bài viết mẫu",
    source: "VnExpress",
    url: "https://example.com/article",
    urlHash: "abc123",
    description: "Mô tả bài viết",
    publishedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function pageResponse(page: number, data: any[], total: number, limit = 20) {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RawArticlesScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("RawArticlesScreen — Dedup UI", () => {
  beforeEach(() => {
    mockedFetchPaginated.mockReset();
    mockedApiAxios.get.mockReset();
    mockedApiAxios.patch.mockReset();
  });

  // --- 1. Status tags ---
  it('shows red "Trùng lặp" tag for duplicate articles', async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-123",
      duplicateScore: 0.95,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));

    renderScreen();
    expect(await screen.findByText("Trùng lặp")).toBeInTheDocument();
    expect(screen.getByText("(95%)")).toBeInTheDocument();
  });

  it('shows green "Đã lưu" tag for saved articles', async () => {
    const article = makeRawArticle({ savedArticleId: "news-456" });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));

    renderScreen();
    expect(await screen.findByText("Đã lưu")).toBeInTheDocument();
  });

  it('shows gray "Chờ xử lý" tag for pending articles', async () => {
    const article = makeRawArticle({});
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));

    renderScreen();
    expect(await screen.findByText("Chờ xử lý")).toBeInTheDocument();
  });

  // --- 2. "Xem bài gốc" button + modal ---
  it('opens modal with original article data when clicking "Xem bài gốc"', async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-789",
      duplicateScore: 0.92,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));

    // Mock the API response for the original article BEFORE rendering
    mockedApiAxios.get.mockResolvedValue({
      data: {
        data: {
          _id: "news-789",
          title: "Bài viết gốc",
          source: "Thanh Niên",
          publishDate: "2026-08-09T00:00:00.000Z",
          summary: "Tóm tắt bài viết gốc",
          url: "https://example.com/original",
        },
      },
    });

    renderScreen();
    await screen.findByText("Trùng lặp");
    // Click "Xem bài gốc" button
    fireEvent.click(
      screen.getByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    );

    // Wait for modal header to appear
    await waitFor(() => {
      expect(screen.getByText("Bài gốc (trùng lặp)")).toBeInTheDocument();
    });
    // Wait for article data to load (React Query async)
    expect(await screen.findByText("Bài viết gốc")).toBeInTheDocument();
    expect(screen.getByText("Thanh Niên")).toBeInTheDocument();
    expect(screen.getByText("Tóm tắt bài viết gốc")).toBeInTheDocument();

    expect(mockedApiAxios.get).toHaveBeenCalledWith(
      "/news-manager/articles/news-789",
      expect.anything(),
    );
  });

  // --- 3. "Bỏ đánh dấu trùng lặp" button ---
  it('calls override API when "Bỏ đánh dấu trùng lặp" is clicked', async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-789",
      duplicateScore: 0.92,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));
    mockedApiAxios.get.mockResolvedValue({
      data: {
        data: {
          _id: "news-789",
          title: "Bài viết gốc",
          url: "https://example.com/original",
        },
      },
    });

    renderScreen();
    await screen.findByText("Trùng lặp");
    // Open the modal first
    fireEvent.click(
      screen.getByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Bỏ đánh dấu trùng lặp")).toBeInTheDocument();
    });

    // Wait for article data to load before clicking override
    await screen.findByText("Bài viết gốc");
    // Click the override button
    fireEvent.click(screen.getByText("Bỏ đánh dấu trùng lặp"));
    await waitFor(() => {
      expect(mockedApiAxios.patch).toHaveBeenCalledWith(
        `/news-manager/raw-articles/${article._id}/override-duplicate`,
      );
    });
  });

  // --- 4. No "Xem bài gốc" for non-duplicates ---
  it('does not show "Xem bài gốc" button for non-duplicate articles', async () => {
    const savedArticle = makeRawArticle({ savedArticleId: "news-111" });
    const pendingArticle = makeRawArticle({ title: "Bài chờ xử lý" });
    mockedFetchPaginated.mockResolvedValue(
      pageResponse(1, [savedArticle, pendingArticle], 2),
    );

    renderScreen();
    await screen.findByText("Đã lưu");
    expect(
      screen.queryByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    ).not.toBeInTheDocument();
  });

  // --- 5. Modal closes on backdrop click ---
  it("closes modal when clicking the backdrop", async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-789",
      duplicateScore: 0.92,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));
    mockedApiAxios.get.mockResolvedValue({
      data: {
        data: {
          _id: "news-789",
          title: "Bài viết gốc",
          url: "https://example.com/original",
        },
      },
    });

    renderScreen();
    await screen.findByText("Trùng lặp");
    // Open modal
    fireEvent.click(
      screen.getByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Bài gốc (trùng lặp)")).toBeInTheDocument();
    });

    // Click backdrop (the overlay div with fixed inset-0)
    const backdrop = screen
      .getByText("Bài gốc (trùng lặp)")
      .closest(".fixed")!;
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(
        screen.queryByText("Bài gốc (trùng lặp)"),
      ).not.toBeInTheDocument();
    });
  });

  // --- 6. Table has "Trạng thái" column header ---
  it('renders "Trạng thái" column header in the table', async () => {
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [], 0));

    renderScreen();

    await waitFor(() => {
      expect(
        screen.getByRole("columnheader", { name: /Trạng thái/i }),
      ).toBeInTheDocument();
    });
  });

  // --- m4: Modal error state (QA finding) ---
  it('shows "Không tìm thấy bài gốc" when original article API fails', async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-789",
      duplicateScore: 0.92,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));
    mockedApiAxios.get.mockRejectedValue(new Error("Not found"));

    renderScreen();
    await screen.findByText("Trùng lặp");

    fireEvent.click(
      screen.getByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Không tìm thấy bài gốc."),
      ).toBeInTheDocument();
    });
  });

  // --- m5: Modal loading state (QA finding) ---
  it("shows loading skeleton while fetching original article", async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-789",
      duplicateScore: 0.92,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));

    let resolveGet!: (value: any) => void;
    mockedApiAxios.get.mockImplementation(
      () => new Promise((r) => (resolveGet = r)),
    );

    renderScreen();
    await screen.findByText("Trùng lặp");

    fireEvent.click(
      screen.getByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Bài gốc (trùng lặp)")).toBeInTheDocument();
    });
    // Loading skeleton should be visible (animate-pulse div)
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();

    // Resolve the API call
    resolveGet({
      data: {
        data: {
          _id: "news-789",
          title: "Bài viết gốc",
          source: "Thanh Niên",
          url: "https://example.com/original",
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Bài viết gốc")).toBeInTheDocument();
      expect(screen.getByText("Thanh Niên")).toBeInTheDocument();
    });
    expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });

  // --- m7: Override button full flow (QA finding) ---
  it("calls PATCH override-duplicate and shows success, then refreshes list", async () => {
    const article = makeRawArticle({
      isDuplicate: true,
      duplicateOfArticleId: "news-789",
      duplicateScore: 0.92,
    });
    mockedFetchPaginated.mockResolvedValue(pageResponse(1, [article], 1));
    mockedApiAxios.get.mockResolvedValue({
      data: {
        data: {
          _id: "news-789",
          title: "Bài viết gốc",
          url: "https://example.com/original",
        },
      },
    });
    mockedApiAxios.patch.mockResolvedValue({});

    renderScreen();
    await screen.findByText("Trùng lặp");

    // Open the modal
    fireEvent.click(
      screen.getByRole("button", { name: "Xem bài gốc bị trùng lặp" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Bỏ đánh dấu trùng lặp")).toBeInTheDocument();
    });
    await screen.findByText("Bài viết gốc");

    // Click override button
    fireEvent.click(screen.getByText("Bỏ đánh dấu trùng lặp"));

    await waitFor(() => {
      expect(mockedApiAxios.patch).toHaveBeenCalledWith(
        `/news-manager/raw-articles/${article._id}/override-duplicate`,
      );
    });

    // Verify success message
    await waitFor(() => {
      expect(
        screen.getByText("Đã bỏ đánh dấu trùng lặp thành công."),
      ).toBeInTheDocument();
    });

    // Verify modal closed and list refreshed (fetchPaginated called again)
    await waitFor(() => {
      expect(mockedFetchPaginated).toHaveBeenCalledTimes(2);
    });
  });
});
