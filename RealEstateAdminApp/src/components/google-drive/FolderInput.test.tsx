import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FolderInput from "./FolderInput";
import * as googleDriveApi from "../../api/google-drive.api";

vi.mock("../../api/google-drive.api");

const mockedValidate = vi.mocked(googleDriveApi.validateGoogleDriveFolder);

function renderInput(
  overrides: { isExporting?: boolean; onConfirm?: () => void; onCancel?: () => void } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onConfirm = overrides.onConfirm ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <FolderInput
        onConfirm={onConfirm}
        onCancel={onCancel}
        isExporting={overrides.isExporting ?? false}
      />
    </QueryClientProvider>,
  );

  return { ...result, onConfirm, onCancel };
}

describe("FolderInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hiển thị input, label, và các nút", () => {
    renderInput();

    expect(screen.getByText(/Folder URL/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hủy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("input placeholder hiển thị đúng", () => {
    renderInput();

    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "https://drive.google.com/drive/folders/...",
    );
  });

  it("onChange cập nhật giá trị input và reset validation", async () => {
    renderInput();
    const input = screen.getByRole("textbox");

    // Type a URL to trigger validation first
    mockedValidate.mockResolvedValueOnce({ valid: true, folderName: "Test Folder" });

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/abc" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Folder: Test Folder")).toBeInTheDocument();
    });

    // Now type more — validation should reset
    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/abc/xyz" } });

    // Previous validation result should be gone
    expect(screen.queryByText("Folder: Test Folder")).not.toBeInTheDocument();
  });

  it("blur triggers validateGoogleDriveFolder khi có giá trị", async () => {
    mockedValidate.mockResolvedValueOnce({ valid: true, folderName: "My Reports" });

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/abc" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockedValidate).toHaveBeenCalledWith(
        "https://drive.google.com/drive/folders/abc",
        expect.anything(),
      );
    });
  });

  it("blur không gọi validate khi input trống", () => {
    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.blur(input);

    expect(mockedValidate).not.toHaveBeenCalled();
  });

  it("paste triggers validateGoogleDriveFolder", async () => {
    mockedValidate.mockResolvedValueOnce({ valid: true, folderName: "Pasted Folder" });

    renderInput();
    const input = screen.getByRole("textbox");

    // Set value via change, then paste event (paste doesn't change value via fireEvent)
    // We simulate the paste by changing the value and firing the paste event
    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/paste123" } });

    // Simulate paste — since fireEvent.paste doesn't update value,
    // we trigger validate directly via change+blur which is equivalent
    fireEvent.paste(input);

    await waitFor(() => {
      expect(mockedValidate).toHaveBeenCalledWith(
        "https://drive.google.com/drive/folders/paste123",
        expect.anything(),
      );
    });
  });

  it("hiển thị spinner khi đang validate", async () => {
    // Keep validate pending
    let resolveValidate: (v: any) => void;
    mockedValidate.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveValidate = resolve;
      }),
    );

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/loading" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Đang kiểm tra folder...")).toBeInTheDocument();
    });

    // Clean up
    await act(async () => {
      resolveValidate!({ valid: true, folderName: "Done" });
    });
  });

  it("hiển thị tên folder khi validation thành công", async () => {
    mockedValidate.mockResolvedValueOnce({ valid: true, folderName: "Reports Q3" });

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/valid" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Folder: Reports Q3")).toBeInTheDocument();
    });
  });

  it("hiển thị lỗi khi validation thất bại (valid=false)", async () => {
    mockedValidate.mockResolvedValueOnce({ valid: false, message: "Folder not found" });

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/bad" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Folder not found")).toBeInTheDocument();
    });
  });

  it("hiển thị lỗi mặc định khi validation trả về valid=false không có message", async () => {
    mockedValidate.mockResolvedValueOnce({ valid: false });

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/bad" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Folder không hợp lệ")).toBeInTheDocument();
    });
  });

  it("hiển thị lỗi khi validate API bị lỗi", async () => {
    mockedValidate.mockRejectedValueOnce(new Error("Network error"));

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/err" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Không thể validate folder. Vui lòng thử lại.")).toBeInTheDocument();
    });
  });

  it("bấm Export gọi onConfirm với URL đã trim", async () => {
    const { onConfirm } = renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, {
      target: { value: "  https://drive.google.com/drive/folders/confirm  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(onConfirm).toHaveBeenCalledWith("https://drive.google.com/drive/folders/confirm");
  });

  it("bấm Hủy gọi onCancel", () => {
    const { onCancel } = renderInput();

    fireEvent.click(screen.getByRole("button", { name: /hủy/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("input và nút disabled khi isExporting=true", () => {
    renderInput({ isExporting: true });

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /hủy/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("nút Export disabled khi đang validate", async () => {
    // Keep validate pending
    let resolveValidate: (v: any) => void;
    mockedValidate.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveValidate = resolve;
      }),
    );

    renderInput();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "https://drive.google.com/drive/folders/pending" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText("Đang kiểm tra folder...")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();

    // Clean up
    await act(async () => {
      resolveValidate!({ valid: true, folderName: "Done" });
    });
  });
});
