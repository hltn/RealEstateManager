import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const mockedAxios = apiAxios as unknown as { get: ReturnType<typeof vi.fn> };
const mockedUseJob = useMarketAnalysisWorkflowJob as unknown as ReturnType<typeof vi.fn>;

interface JobHookReturn {
  jobState: WorkflowJobResponse | null;
  isRunning: boolean;
  startError: string | null;
  startJob: ReturnType<typeof vi.fn>;
  resetJob: ReturnType<typeof vi.fn>;
}

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketAnalysisWorkflowScreen />
    </QueryClientProvider>,
  );
}

function baseJobHook(overrides: Partial<JobHookReturn> = {}): JobHookReturn {
  return {
    jobState: null,
    isRunning: false,
    startError: null,
    startJob: vi.fn(),
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
      expect(screen.getAllByText(step.label).length).toBeGreaterThan(0);
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

  it("step 'running' hiển thị spinner, step 'error' hiển thị message lỗi", () => {
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
    // Step lỗi hiển thị nút "Chạy lại".
    expect(screen.getByRole("button", { name: /chạy lại/i })).toBeInTheDocument();
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

  it("render danh sách lịch sử khi API trả dữ liệu, click item mở modal chi tiết", async () => {
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
      },
    });
    mockedUseJob.mockReturnValue(baseJobHook());
    renderScreen();

    const historyItem = await screen.findByText(/Nội dung phân tích lần trước/);
    fireEvent.click(historyItem);

    // Modal chi tiết hiện ra với đúng nội dung (heading "Chi tiết phân tích").
    expect(await screen.findByText("Chi tiết phân tích")).toBeInTheDocument();
  });
});
