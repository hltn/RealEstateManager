import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import apiAxios from "../api/axios";
import {
  MarketAnalysisWorkflowJobProvider,
  useMarketAnalysisWorkflowJob,
  DEFAULT_STEPS,
} from "./MarketAnalysisWorkflowJobContext";

vi.mock("../api/axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedAxios = apiAxios as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

/** Component test dùng hook — expose state ra DOM để assert. */
const TestConsumer: React.FC = () => {
  const { jobState, isRunning, startError, startJob, resetJob } = useMarketAnalysisWorkflowJob();
  return (
    <div>
      <span data-testid="status">{jobState?.status ?? "idle"}</span>
      <span data-testid="is-running">{String(isRunning)}</span>
      <span data-testid="start-error">{startError ?? ""}</span>
      <span data-testid="current-step">{String(jobState?.currentStep ?? "")}</span>
      <button onClick={() => { void startJob("2026-08-06").catch(() => {}); }}>start</button>
      <button onClick={resetJob}>reset</button>
    </div>
  );
};

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketAnalysisWorkflowJobProvider>
        <TestConsumer />
      </MarketAnalysisWorkflowJobProvider>
    </QueryClientProvider>,
  );
}

describe("MarketAnalysisWorkflowJobContext", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("useMarketAnalysisWorkflowJob throws khi dùng ngoài Provider", () => {
    // Test bắt lỗi thật của hook guard — không tautology vì gọi hook trực tiếp,
    // không giả lập kết quả mong đợi từ chính implementation.
    const ConsumerWithoutProvider = () => {
      useMarketAnalysisWorkflowJob();
      return null;
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ConsumerWithoutProvider />)).toThrow(
      "useMarketAnalysisWorkflowJob must be used within a MarketAnalysisWorkflowJobProvider",
    );
    consoleError.mockRestore();
  });

  it("trạng thái ban đầu: chưa có job, isRunning=false, jobState=null", () => {
    renderWithProviders();
    expect(screen.getByTestId("status").textContent).toBe("idle");
    expect(screen.getByTestId("is-running").textContent).toBe("false");
  });

  it("startJob gọi đúng endpoint POST và set jobId để bắt đầu poll", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { message: "ok", jobId: "job-123" } });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: "pending",
        currentStep: 1,
        steps: DEFAULT_STEPS.map((s, i) => (i === 0 ? { ...s, status: "running" } : s)),
      },
    });

    renderWithProviders();
    await act(async () => {
      screen.getByText("start").click();
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "/news-manager/market-analysis-workflow",
      { date: "2026-08-06" },
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("pending");
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "/news-manager/market-analysis-workflow/job-123",
      expect.any(Object),
    );
  });

  it("khi POST trả lỗi 409 (lock conflict) → startError chứa message từ BE", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 409, data: { message: "Đang có phân tích thị trường đang chạy" } },
    });

    renderWithProviders();
    await act(async () => {
      screen.getByText("start").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("start-error").textContent).toBe(
        "Đang có phân tích thị trường đang chạy",
      );
    });
    // Không set jobId khi start thất bại → vẫn ở trạng thái idle, không "pending" giả.
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("khi poll trả status='done' → dừng polling, jobState phản ánh currentStep=5", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { message: "ok", jobId: "job-456" } });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: "done",
        currentStep: 5,
        steps: DEFAULT_STEPS.map((s) => ({ ...s, status: "done" })),
        result: { markdownContent: "# Kết quả" },
      },
    });

    renderWithProviders();
    await act(async () => {
      screen.getByText("start").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("done");
    });
    expect(screen.getByTestId("current-step").textContent).toBe("5");
  });

  it("resetJob xóa jobId và startError, quay về trạng thái idle", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 409, data: { message: "Conflict" } },
    });

    renderWithProviders();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("start-error").textContent).toBe("Conflict");
    });

    act(() => {
      screen.getByText("reset").click();
    });

    expect(screen.getByTestId("start-error").textContent).toBe("");
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });
});
