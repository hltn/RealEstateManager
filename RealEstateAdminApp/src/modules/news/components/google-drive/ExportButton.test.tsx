import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExportButton from "./ExportButton";
import * as googleDriveApi from "../../api/google-drive.api";
import * as googleDriveAuth from "../../context/GoogleDriveAuthContext";

interface GoogleDriveExport {
  documentId: string;
  documentUrl: string;
  title: string;
  exportedAt: string;
}

vi.mock("../../api/google-drive.api");
vi.mock("../../context/GoogleDriveAuthContext");

const mockedExport = vi.mocked(googleDriveApi.exportToGoogleDrive);
const mockedUseAuth = vi.mocked(googleDriveAuth.useGoogleDriveAuth);

type RenderButtonProps = Partial<Omit<ComponentProps<typeof ExportButton>, "historyId">>;

function renderButton(
  props?: RenderButtonProps,
  overrides: Partial<ReturnType<typeof googleDriveAuth.useGoogleDriveAuth>> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
      <ExportButton historyId="hist123" {...props} />
    </QueryClientProvider>,
  );
}

describe("ExportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hiển thị disabled khi chưa kết nối Google Drive", () => {
    renderButton(undefined, { isConnected: false });

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Export");
  });

  it("hiển thị enabled khi đã kết nối", () => {
    renderButton(undefined, { isConnected: true });

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

    describe("với googleDriveExport prop", () => {
    const mockGoogleDriveExport: GoogleDriveExport = {
      documentId: "doc123",
      documentUrl: "https://docs.google.com/document/d/doc123/edit",
      title: "Market Analysis Report",
      exportedAt: "2024-01-15T10:30:00.000Z",
    };

    it("hiển thị đã export badge, link Drive và nút re-export khi có googleDriveExport", () => {
      renderButton({ googleDriveExport: mockGoogleDriveExport });

      expect(screen.getByText(/đã export!/i)).toBeInTheDocument();
      const link = screen.getByText("Mở Drive");
      expect(link).toHaveAttribute("href", mockGoogleDriveExport.documentUrl);
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.queryByText("Export")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /export lại/i })).toBeInTheDocument();
    });

    it("click nút re-export bắt đầu export lại", async () => {
      mockedExport.mockResolvedValueOnce({
        message: "ok",
        data: { documentId: "doc123", documentUrl: "https://docs.google.com/document/d/doc123/edit", title: "t" },
      });
      renderButton({ googleDriveExport: mockGoogleDriveExport });

      fireEvent.click(screen.getByRole("button", { name: /export lại/i }));

      // Mutation phải gọi API với đúng historyId và UI hiện trạng thái đang export
      expect(screen.getByText("Đang export...")).toBeInTheDocument();
      await waitFor(() => expect(mockedExport).toHaveBeenCalledWith("hist123"));
      expect(await screen.findByText("Đã export!")).toBeInTheDocument();
    });

    it("hiển thị lỗi khi re-export thất bại dù đã có googleDriveExport, giữ link Drive cũ", async () => {
      mockedExport.mockRejectedValueOnce({ response: { data: { message: "Quota exceeded" } } });
      renderButton({ googleDriveExport: mockGoogleDriveExport });

      fireEvent.click(screen.getByRole("button", { name: /export lại/i }));

      expect(await screen.findByText("Quota exceeded")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
      expect(screen.queryByText(/đã export!/i)).not.toBeInTheDocument();
      expect(screen.getByText("Mở Drive")).toHaveAttribute("href", mockGoogleDriveExport.documentUrl);
    });

    it("hiển thị Mở Drive link với href đúng từ googleDriveExport", () => {
      renderButton({ googleDriveExport: mockGoogleDriveExport });

      const link = screen.getByText("Mở Drive");
      expect(link).toHaveAttribute(
        "href",
        "https://docs.google.com/document/d/doc123/edit"
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("khi đang re-export thì ẩn link Drive và hiển thị trạng thái đang export", async () => {
      let resolveExport: (v: googleDriveApi.GoogleDriveExportResult) => void = () => {};
      mockedExport.mockReturnValueOnce(new Promise((resolve) => { resolveExport = resolve; }));
      renderButton({ googleDriveExport: mockGoogleDriveExport });

      fireEvent.click(screen.getByRole("button", { name: /export lại/i }));

      expect(await screen.findByText("Đang export...")).toBeInTheDocument();
      expect(screen.queryByText("Mở Drive")).not.toBeInTheDocument();

      // Giải phóng mutation trong act() để không còn cập nhật state ngoài act
      await act(async () => {
        resolveExport({ message: "ok", data: { documentId: "d", documentUrl: "https://x/d", title: "t" } });
      });
      expect(await screen.findByText("Mở Drive")).toHaveAttribute("href", "https://x/d");
    });

    it("hiển thị UI bình thường khi googleDriveExport là null", () => {
      renderButton({ googleDriveExport: null });

      const button = screen.getByRole("button", { name: /export/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("Export");
    });

    it("thông báo onExportSuccess khi export thành công", async () => {
      const mockOnExportSuccess = vi.fn();
      mockedExport.mockResolvedValueOnce({
        message: "Export successful",
        data: {
          documentId: "doc456",
          documentUrl: "https://docs.google.com/document/d/doc456/edit",
          title: "New Report",
        },
      });

      renderButton({
        googleDriveExport: mockGoogleDriveExport,
        onExportSuccess: mockOnExportSuccess,
      });

      fireEvent.click(screen.getByRole("button", { name: /export lại/i }));

      // onExportSuccess phải được gọi với đúng kết quả API khi mutation thành công
      await waitFor(() => {
        expect(mockOnExportSuccess).toHaveBeenCalledTimes(1);
      });
      expect(mockOnExportSuccess.mock.calls[0][0]).toEqual({
        message: "Export successful",
        data: {
          documentId: "doc456",
          documentUrl: "https://docs.google.com/document/d/doc456/edit",
          title: "New Report",
        },
      });
      // UI chuyển sang dữ liệu export mới
      expect(await screen.findByText("Mở Drive")).toHaveAttribute(
        "href",
        "https://docs.google.com/document/d/doc456/edit",
      );
    });
  });
});
