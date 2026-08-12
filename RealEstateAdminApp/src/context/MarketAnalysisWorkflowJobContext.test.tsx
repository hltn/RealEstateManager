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
  const {
    jobState,
    isRunning,
    startError,
    startJob,
    retryFailedStep,
    isRetrying,
    retryError,
    resetJob,
  } = useMarketAnalysisWorkflowJob();
  return (
    <div>
      <span data-testid="status">{jobState?.status ?? "idle"}</span>
      <span data-testid="is-running">{String(isRunning)}</span>
      <span data-testid="start-error">{startError ?? ""}</span>
      <span data-testid="retry-error">{retryError ?? ""}</span>
      <span data-testid="is-retrying">{String(isRetrying)}</span>
      <span data-testid="current-step">{String(jobState?.currentStep ?? "")}</span>
      <span data-testid="steps">
        {jobState?.steps?.map((step) => `${step.step}:${step.status}`).join(",") ?? ""}
      </span>
      <button onClick={() => { void startJob("2026-08-06").catch(() => {}); }}>start</button>
      <button onClick={() => { void retryFailedStep().catch(() => {}); }}>retry</button>
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

  it("retry gọi đúng POST endpoint với cùng jobId, không reset progress done và refetch job cũ", async () => {
    const failedSteps = DEFAULT_STEPS.map((step) => {
      if (step.step < 3) return { ...step, status: "done" as const };
      if (step.step === 3) return { ...step, status: "error" as const, error: "save failed" };
      return step;
    });
    mockedAxios.post
      .mockResolvedValueOnce({ data: { message: "ok", jobId: "job-retry" } })
      .mockResolvedValueOnce({ data: { message: "retrying", jobId: "job-retry" } });
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { status: "error", currentStep: 3, steps: failedSteps, error: "save failed" },
      })
      .mockResolvedValue({
        data: {
          status: "pending",
          currentStep: 3,
          steps: failedSteps.map((step) =>
            step.step === 3 ? { ...step, status: "running", error: undefined } : step,
          ),
        },
      });

    renderWithProviders();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));

    await act(async () => {
      screen.getByText("retry").click();
    });

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "/news-manager/market-analysis-workflow/job-retry/retry",
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("pending"));
    expect(screen.getByTestId("steps").textContent).toContain("1:done,2:done,3:running");
    expect(mockedAxios.get).toHaveBeenLastCalledWith(
      "/news-manager/market-analysis-workflow/job-retry",
      expect.any(Object),
    );
  });

  it("retry pending expose loading; API failure giữ nguyên error và progress đã done", async () => {
    let rejectRetry!: (reason: unknown) => void;
    const retryRequest = new Promise((_resolve, reject) => {
      rejectRetry = reject;
    });
    const failedSteps = DEFAULT_STEPS.map((step) => {
      if (step.step === 1) return { ...step, status: "done" as const };
      if (step.step === 2) return { ...step, status: "error" as const, error: "AI down" };
      return step;
    });
    mockedAxios.post
      .mockResolvedValueOnce({ data: { message: "ok", jobId: "job-failure" } })
      .mockReturnValueOnce(retryRequest);
    mockedAxios.get.mockResolvedValueOnce({
      data: { status: "error", currentStep: 2, steps: failedSteps, error: "AI down" },
    });

    renderWithProviders();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));

    act(() => {
      screen.getByText("retry").click();
    });
    await waitFor(() => expect(screen.getByTestId("is-retrying").textContent).toBe("true"));
    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("steps").textContent).toContain("1:done,2:error");

    await act(async () => {
      rejectRetry({ response: { data: { message: "Retry service unavailable" } } });
      await retryRequest.catch(() => {});
    });

    await waitFor(() => expect(screen.getByTestId("is-retrying").textContent).toBe("false"));
    expect(screen.getByTestId("retry-error").textContent).toBe("Retry service unavailable");
    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("steps").textContent).toContain("1:done,2:error");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
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
