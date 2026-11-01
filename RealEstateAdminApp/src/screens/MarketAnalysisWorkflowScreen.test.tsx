import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import apiAxios from "../api/axios";
import MarketAnalysisWorkflowScreen from "./MarketAnalysisWorkflowScreen";
import {
  useMarketAnalysisWorkflowJob,
  DEFAULT_STEPS,
  type WorkflowJobResponse,
} from "../context/MarketAnalysisWorkflowJobContext";

vi.mock("../api/axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../context/MarketAnalysisWorkflowJobContext", async () => {
  const actual = await vi.importActual<
    typeof import("../context/MarketAnalysisWorkflowJobContext")
  >("../context/MarketAnalysisWorkflowJobContext");
  return {
    ...actual,
    useMarketAnalysisWorkflowJob: vi.fn(),
  };
});

vi.mock("../components/google-drive/GoogleDriveStatusBadge", () => ({
  default: () => <span data-testid="gdrive-status-badge">Mock Badge</span>,
}));

// Mock ExportButton: bấm nút sẽ giả lập export thành công (gọi onExportSuccess như component thật),
// đồng thời hiển thị documentUrl từ prop googleDriveExport để kiểm tra UI được cập nhật theo cache.
vi.mock("../components/google-drive/ExportButton", () => ({
  default: ({
    historyId,
    googleDriveExport,
    onExportSuccess,
  }: {
    historyId: string;
    googleDriveExport?: { documentUrl: string } | null;
    onExportSuccess?: (result: {
      message: string;
      data: { documentId: string; documentUrl: string; title: string };
    }) => void;
  }) => (
    <div>
      <button
        data-testid={`export-btn-${historyId}`}
        onClick={() =>
          onExportSuccess?.({
            message: "ok",
            data: {
              documentId: `doc-${historyId}`,
              documentUrl: `https://docs.google.com/document/d/doc-${historyId}/edit`,
              title: `Báo cáo ${historyId}`,
            },
          })
        }
      >
        Mock Export
      </button>
      <span data-testid={`export-url-${historyId}`}>{googleDriveExport?.documentUrl ?? "none"}</span>
    </div>
  ),
}));

vi.mock("../context/GoogleDriveAuthContext", () => ({
  GoogleDriveAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useGoogleDriveAuth: () => ({
    isConnected: true,
    email: "user@gmail.com",
    connectedAt: null,
    isLoading: false,
    refetchStatus: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isDisconnecting: false,
  }),
}));

const mockedAxios = apiAxios as unknown as { get: ReturnType<typeof vi.fn> };
const mockedUseJob = useMarketAnalysisWorkflowJob as unknown as ReturnType<typeof vi.fn>;

interface JobHookReturn {
  jobState: WorkflowJobResponse | null;
  isRunning: boolean;
  startError: string | null;
  startJob: ReturnType<typeof vi.fn>;
  retryFailedStep: ReturnType<typeof vi.fn>;
  isRetrying: boolean;
  retryError: string | null;
  resetJob: ReturnType<typeof vi.fn>;
}

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MarketAnalysisWorkflowScreen />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

function baseJobHook(overrides: Partial<JobHookReturn> = {}): JobHookReturn {
  return {
    jobState: null,
    isRunning: false,
    startError: null,
    startJob: vi.fn(),
    retryFailedStep: vi.fn(),
    isRetrying: false,
    retryError: null,
    resetJob: vi.fn(),
    ...overrides,
  };
}

describe("MarketAnalysisWorkflowScreen", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });
    mockedUseJob.mockReset();
  });

  it("hiển thị 5 step card mặc định (pending) khi chưa có job", async () => {
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Phân tích thị trường" })).toBeInTheDocument();
    for (const step of DEFAULT_STEPS) {
      expect(screen.getAllByText(`${step.step}.${step.label}`).length).toBeGreaterThan(0);
    }
    // Nút "Phân tích" phải khả dụng (không disabled) khi không có job đang chạy.
    const button = screen.getByRole("button", { name: /^phân tích$/i });
    expect(button).not.toBeDisabled();
  });

  it("disable nút 'Phân tích' khi isRunning=true — tránh double-submit", () => {
    mockedUseJob.mockReturnValue(baseJobHook({ isRunning: true }));
    renderScreen();

    const button = screen.getByRole("button", { name: /đang phân tích/i });
    expect(button).toBeDisabled();
  });

  it("bấm nút 'Phân tích' gọi startJob với ngày đã chọn (mặc định hôm nay)", () => {
    const startJob = vi.fn();
    mockedUseJob.mockReturnValue(baseJobHook({ startJob }));
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: /^phân tích$/i }));

    expect(startJob).toHaveBeenCalledTimes(1);
    // Không assert giá trị cứng bằng cách gọi lại hàm tính ngày trong test — thay vào đó
    // chỉ xác nhận có truyền 1 chuỗi ngày dạng YYYY-MM-DD, tránh tautology với logic ngày của component.
    const calledWithDate = startJob.mock.calls[0][0];
    expect(calledWithDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("hiển thị retry trong card bước lỗi, không hiển thị nút đóng", () => {
    const stepsWithError = DEFAULT_STEPS.map((s) => {
      if (s.step === 1) return { ...s, status: "done" as const };
      if (s.step === 2) return { ...s, status: "error" as const, error: "Lỗi lọc bài viết" };
      return s;
    });
    mockedUseJob.mockReturnValue(
      baseJobHook({
        jobState: { status: "error", currentStep: 2, steps: stepsWithError, error: "Lỗi lọc bài viết" },
      }),
    );
    renderScreen();

    expect(screen.getByText("Lỗi lọc bài viết")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thực hiện lại" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đóng thông báo lỗi" })).not.toBeInTheDocument();
  });

  it("bấm retry ở status error gọi retryFailedStep, không gọi resetJob/startJob", () => {
    const retryFailedStep = vi.fn();
    const resetJob = vi.fn();
    const startJob = vi.fn();
    mockedUseJob.mockReturnValue(
      baseJobHook({
        jobState: {
          status: "error",
          currentStep: 2,
          steps: DEFAULT_STEPS.map((step) =>
            step.step === 1
              ? { ...step, status: "done" as const }
              : step.step === 2
                ? { ...step, status: "error" as const, error: "AI down" }
                : step,
          ),
        },
        retryFailedStep,
        resetJob,
        startJob,
      }),
    );
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Thực hiện lại" }));

    expect(retryFailedStep).toHaveBeenCalledTimes(1);
    expect(resetJob).not.toHaveBeenCalled();
    expect(startJob).not.toHaveBeenCalled();
    expect(screen.getByText("1.Thu thập tin tức")).toBeInTheDocument();
  });

  it("retry loading disable cả nút retry và Analyze, hiển thị API error nhưng giữ progress", () => {
    mockedUseJob.mockReturnValue(
      baseJobHook({
        jobState: {
          status: "error",
          currentStep: 2,
          steps: DEFAULT_STEPS.map((step) =>
            step.step === 1
              ? { ...step, status: "done" as const }
              : step.step === 2
                ? { ...step, status: "error" as const, error: "AI down" }
                : step,
          ),
        },
        isRetrying: true,
        retryError: "Retry service unavailable",
      }),
    );
    renderScreen();

    expect(screen.getByRole("button", { name: "Đang thực hiện lại" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^phân tích$/i })).toBeDisabled();
    expect(screen.getByText("Retry service unavailable")).toBeInTheDocument();
    expect(screen.getByText("AI down")).toBeInTheDocument();
  });

  it("khi status='done' và có markdownContent → hiển thị kết quả phân tích", async () => {
    mockedUseJob.mockReturnValue(
      baseJobHook({
        jobState: {
          status: "done",
          currentStep: 5,
          steps: DEFAULT_STEPS.map((s) => ({ ...s, status: "done" as const })),
          result: { markdownContent: "Kết quả phân tích thị trường XYZ" },
        },
      }),
    );
    renderScreen();

    expect(await screen.findByText(/Kết quả phân tích thị trường XYZ/)).toBeInTheDocument();
  });

  it("status='not_found' → hiển thị thông báo lỗi rõ ràng cho user", () => {
    mockedUseJob.mockReturnValue(
      baseJobHook({
        jobState: { status: "not_found" },
      }),
    );
    renderScreen();

    expect(screen.getByText(/không tìm thấy job/i)).toBeInTheDocument();
  });

  it("hiển thị 'Chưa có lịch sử phân tích' khi API lịch sử trả mảng rỗng", async () => {
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    expect(await screen.findByText(/chưa có lịch sử phân tích/i)).toBeInTheDocument();
  });

  it("render danh sách lịch sử khi API trả dữ liệu, click item hoặc nút Xem mở modal chi tiết", async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [
          {
            _id: "h1",
            content: "Nội dung phân tích lần trước",
            articleIds: ["a1", "a2"],
            createdAt: "2026-08-05T10:00:00.000Z",
          },
        ],
        meta: { hasMore: false, nextCursor: null },
      },
    });
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    expect(await screen.findByText("1. 05/08/2026 17:00:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết phân tích 1" }));

    // Modal chi tiết hiện ra với đúng nội dung (heading "Chi tiết phân tích").
    expect(await screen.findByText("Chi tiết phân tích")).toBeInTheDocument();
  });

  it("tải thêm trang lịch sử bằng cursor, giữ số thứ tự và không gửi request trùng", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          data: Array.from({ length: 10 }, (_, index) => ({
            _id: `h${index + 1}`,
            content: `Nội dung ${index + 1}`,
            articleIds: [],
            createdAt: "2026-08-05T10:00:00.000Z",
          })),
          meta: { hasMore: true, nextCursor: "cursor-10" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ _id: "h11", content: "Nội dung 11", articleIds: [], createdAt: "2026-08-04T10:00:00.000Z" }],
          meta: { hasMore: false, nextCursor: null },
        },
      });
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    await screen.findByText(/10\. 05\/08\/2026 17:00:00/);
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    await screen.findByText(/11\. 04\/08\/2026 17:00:00/);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get.mock.calls[1][1]).toMatchObject({ params: { cursor: "cursor-10" } });
    expect(screen.getByText("Đã hiển thị tất cả lịch sử.")).toBeInTheDocument();
  });

  it("hiển thị lỗi tải lịch sử và cho phép thử lại", async () => {
    // Query lịch sử cấu hình retry: 1 (tự thử lại 1 lần sau ~1s) nên 2 lần gọi đầu đều phải lỗi
    // thì UI mới hiển thị trạng thái lỗi; lần gọi thứ 3 (bấm "Thử lại") thành công.
    mockedAxios.get
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce({
        data: { data: [], meta: { hasMore: false, nextCursor: null } },
      });
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
      /không thể tải lịch sử phân tích: network unavailable/i,
    );
    // Lỗi không được hiển thị như "chưa có lịch sử"
    expect(screen.queryByText(/chưa có lịch sử phân tích/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(/chưa có lịch sử phân tích/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lỗi khi tải trang 2: giữ danh sách trang 1, hiện lỗi nhỏ và cho phép thử tải lại", async () => {
    const page1 = {
      data: [
        { _id: "h1", content: "Nội dung 1", articleIds: [], createdAt: "2026-08-05T10:00:00.000Z" },
        { _id: "h2", content: "Nội dung 2", articleIds: [], createdAt: "2026-08-04T10:00:00.000Z" },
      ],
      meta: { hasMore: true, nextCursor: "cursor-2" },
    };
    const page2 = {
      data: [{ _id: "h3", content: "Nội dung 3", articleIds: [], createdAt: "2026-08-03T10:00:00.000Z" }],
      meta: { hasMore: false, nextCursor: null },
    };
    mockedAxios.get
      .mockResolvedValueOnce({ data: page1 })
      .mockRejectedValueOnce(new Error("Network unavailable"))
      // retry: 1 của query tự thử lại trang 2 một lần -> lần này cũng lỗi
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce({ data: page2 });
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    await screen.findByText(/2\. 04\/08\/2026 17:00:00/);
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    // Lỗi nhỏ dưới danh sách; danh sách trang 1 vẫn còn, không có khối lỗi toàn khu vực
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/không thể tải thêm lịch sử/i);
    expect(screen.getByText(/1\. 05\/08\/2026 17:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/2\. 04\/08\/2026 17:00:00/)).toBeInTheDocument();
    expect(screen.queryByText(/không thể tải lịch sử phân tích/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/chưa có lịch sử phân tích/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thử tải lại" }));

    expect(await screen.findByText(/3\. 03\/08\/2026 17:00:00/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedAxios.get.mock.calls[3][1]).toMatchObject({ params: { cursor: "cursor-2" } });
  });

  it("hiển thị Google Drive section với badge status", async () => {
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    expect(await screen.findByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByTestId("gdrive-status-badge")).toBeInTheDocument();
  });

  it("hiển thị Export button trên mỗi history row", async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [
          {
            _id: "h1",
            content: "Nội dung phân tích 1",
            articleIds: [],
            createdAt: "2026-08-05T10:00:00.000Z",
          },
          {
            _id: "h2",
            content: "Nội dung phân tích 2",
            articleIds: [],
            createdAt: "2026-08-04T10:00:00.000Z",
          },
        ],
        meta: { hasMore: false, nextCursor: null },
      },
    });
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    expect(await screen.findByText("1. 05/08/2026 17:00:00")).toBeInTheDocument();
    expect(screen.getByTestId("export-btn-h1")).toBeInTheDocument();
    expect(screen.getByTestId("export-btn-h2")).toBeInTheDocument();
  });

  it("export Google Drive thành công cập nhật đúng mục trong cache lịch sử, mục khác giữ nguyên", async () => {
    const historyPage = {
      data: [
        { _id: "h1", content: "Nội dung 1", articleIds: [], createdAt: "2026-08-05T10:00:00.000Z" },
        { _id: "h2", content: "Nội dung 2", articleIds: [], createdAt: "2026-08-04T10:00:00.000Z" },
      ],
      meta: { hasMore: false, nextCursor: null },
    };
    mockedAxios.get.mockResolvedValue({ data: historyPage });
    mockedUseJob.mockReturnValue(baseJobHook());
    const { queryClient } = renderScreen();

    await screen.findByTestId("export-btn-h2");
    expect(screen.getByTestId("export-url-h1")).toHaveTextContent("none");
    expect(screen.getByTestId("export-url-h2")).toHaveTextContent("none");

    // Export mục thứ 2 (h2) - callback không được ném ReferenceError và phải cập nhật đúng h2
    fireEvent.click(screen.getByTestId("export-btn-h2"));

    await waitFor(() =>
      expect(screen.getByTestId("export-url-h2")).toHaveTextContent("https://docs.google.com/document/d/doc-h2/edit"),
    );
    expect(screen.getByTestId("export-url-h1")).toHaveTextContent("none");

    const cached = queryClient.getQueryData<{
      pages: { data: { _id: string; googleDriveExport?: { documentId: string; title: string; exportedAt: string } }[] }[];
    }>(["market-analysis-history"]);
    const [cachedH1, cachedH2] = cached!.pages[0].data;
    expect(cachedH1.googleDriveExport).toBeUndefined();
    expect(cachedH2.googleDriveExport).toMatchObject({ documentId: "doc-h2", title: "Báo cáo h2" });
    expect(Number.isNaN(new Date(cachedH2.googleDriveExport!.exportedAt).getTime())).toBe(false);
  });

  it("export mục ở trang thứ 2 (infinite scroll) cập nhật đúng trang đó, không mutate cache cũ", async () => {
    type CachedItem = { _id: string; googleDriveExport?: { documentId: string } };
    type Cache = { pages: { data: CachedItem[] }[] };
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          data: [{ _id: "h1", content: "Nội dung 1", articleIds: [], createdAt: "2026-08-05T10:00:00.000Z" }],
          meta: { hasMore: true, nextCursor: "cursor-1" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ _id: "h2", content: "Nội dung 2", articleIds: [], createdAt: "2026-08-04T10:00:00.000Z" }],
          meta: { hasMore: false, nextCursor: null },
        },
      });
    mockedUseJob.mockReturnValue(baseJobHook());
    const { queryClient } = renderScreen();

    await screen.findByTestId("export-btn-h1");
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    await screen.findByTestId("export-btn-h2");

    const before = queryClient.getQueryData<Cache>(["market-analysis-history"])!;
    const h1Before = before.pages[0].data[0];

    fireEvent.click(screen.getByTestId("export-btn-h2"));
    await waitFor(() =>
      expect(screen.getByTestId("export-url-h2")).toHaveTextContent("https://docs.google.com/document/d/doc-h2/edit"),
    );
    expect(screen.getByTestId("export-url-h1")).toHaveTextContent("none");

    const after = queryClient.getQueryData<Cache>(["market-analysis-history"])!;
    expect(after.pages).toHaveLength(2);
    expect(after.pages[1].data[0].googleDriveExport).toMatchObject({ documentId: "doc-h2" });
    // Mục khác giữ nguyên tham chiếu; cache cũ không bị mutate (bất biến)
    expect(after.pages[0].data[0]).toBe(h1Before);
    expect(before.pages[1].data[0].googleDriveExport).toBeUndefined();
    expect(after).not.toBe(before);
  });

  it("refetch nền thất bại khi đã có dữ liệu: giữ danh sách, hiện 'Không thể làm mới' và thử tải lại được", async () => {
    const page = {
      data: [{ _id: "h1", content: "Nội dung 1", articleIds: [], createdAt: "2026-08-05T10:00:00.000Z" }],
      meta: { hasMore: false, nextCursor: null },
    };
    mockedAxios.get
      .mockResolvedValueOnce({ data: page })
      // retry: 1 -> lần refetch nền cần 2 lỗi liên tiếp mới sang trạng thái error
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce({ data: page });
    mockedUseJob.mockReturnValue(baseJobHook());
    const { queryClient } = renderScreen();

    await screen.findByText(/1\. 05\/08\/2026 17:00:00/);
    void queryClient.invalidateQueries({ queryKey: ["market-analysis-history"] });

    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/không thể làm mới lịch sử/i);
    expect(screen.getByText(/1\. 05\/08\/2026 17:00:00/)).toBeInTheDocument();
    expect(screen.queryByText(/không thể tải lịch sử phân tích/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thử tải lại" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("Đã hiển thị tất cả lịch sử.")).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledTimes(4);
  });

  it("không tự tải lại vô hạn trang kế khi trang đó lỗi (IntersectionObserver luôn báo đang thấy sentinel)", async () => {
    // Giả lập trình duyệt: sentinel luôn nằm trong viewport -> observer báo intersecting ngay khi observe().
    class AlwaysVisibleObserver {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe() {
        queueMicrotask(() => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
      }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal("IntersectionObserver", AlwaysVisibleObserver);
    try {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            data: [{ _id: "h1", content: "Nội dung 1", articleIds: [], createdAt: "2026-08-05T10:00:00.000Z" }],
            meta: { hasMore: true, nextCursor: "cursor-1" },
          },
        })
        .mockRejectedValue(new Error("Network unavailable"));
      mockedUseJob.mockReturnValue(baseJobHook());
      renderScreen();

      // 1 lần trang đầu + 1 lần tự tải trang 2 (+1 retry nội bộ của query) rồi phải dừng
      expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/không thể tải thêm lịch sử/i);
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);

      // Chờ lâu hơn 1 chu kỳ retry: không được có request mới nào
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
