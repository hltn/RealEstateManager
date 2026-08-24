import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExportButton from "./ExportButton";
import * as googleDriveApi from "../../api/google-drive.api";
import * as googleDriveAuth from "../../context/GoogleDriveAuthContext";

vi.mock("../../api/google-drive.api");
vi.mock("../../context/GoogleDriveAuthContext");

const mockedExport = vi.mocked(googleDriveApi.exportToGoogleDrive);
const mockedUseAuth = vi.mocked(googleDriveAuth.useGoogleDriveAuth);

function renderButton(overrides: Partial<ReturnType<typeof googleDriveAuth.useGoogleDriveAuth>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mockedUseAuth.mockReturnValue({
    isConnected: true,
    email: "user@gmail.com",
    connectedAt: null,
    isLoading: false,
    refetchStatus: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isDisconnecting: false,
    ...overrides,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ExportButton historyId="hist123" />
    </QueryClientProvider>,
  );
}

describe("ExportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hiển thị disabled khi chưa kết nối Google Drive", () => {
    renderButton({ isConnected: false });

    const button = screen.getByRole("button", { name: /export/i });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Export");
  });

  it("hiển thị enabled khi đã kết nối", () => {
    renderButton({ isConnected: true });

    const button = screen.getByRole("button", { name: /export/i });
    expect(button).not.toBeDisabled();
  });

  it("click Export gọi exportToGoogleDrive với historyId", async () => {
    mockedExport.mockResolvedValueOnce({
      message: "Export successful",
      data: {
        documentId: "doc123",
        documentUrl: "https://docs.google.com/document/d/doc123/edit",
        title: "Report",
      },
    });

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(mockedExport).toHaveBeenCalledWith("hist123");
    });
  });

  it("hiển thị spinner khi đang export", async () => {
    // Keep the promise pending to maintain "exporting" state
    let resolveExport: (v: any) => void;
    mockedExport.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    // Button should show exporting state
    expect(await screen.findByText("Đang export...")).toBeInTheDocument();

    // Resolve to clean up — wrap in act() to flush state updates
    await act(async () => {
      resolveExport!({
        message: "ok",
        data: { documentId: "x", documentUrl: "url", title: "t" },
      });
    });
  });

  it("hiển thị thành công + link mở Drive sau export", async () => {
    mockedExport.mockResolvedValueOnce({
      message: "Export successful",
      data: {
        documentId: "doc123",
        documentUrl: "https://docs.google.com/document/d/doc123/edit",
        title: "Report",
      },
    });

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(await screen.findByText("Đã export!")).toBeInTheDocument();
    const link = screen.getByText("Mở Drive");
    expect(link).toHaveAttribute(
      "href",
      "https://docs.google.com/document/d/doc123/edit",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("hiển thị lỗi + nút thử lại khi export thất bại", async () => {
    mockedExport.mockRejectedValueOnce({
      response: { data: { message: "Google Drive not connected" } },
    });

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(
      await screen.findByText("Google Drive not connected"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });

  it("bấm Thử lại gọi lại exportToGoogleDrive", async () => {
    mockedExport
      .mockRejectedValueOnce({
        response: { data: { message: "Network error" } },
      })
      .mockResolvedValueOnce({
        message: "Export successful",
        data: { documentId: "doc456", documentUrl: "url2", title: "t2" },
      });

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await screen.findByText("Thử lại");

    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));

    await waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(2);
    });
  });
});
