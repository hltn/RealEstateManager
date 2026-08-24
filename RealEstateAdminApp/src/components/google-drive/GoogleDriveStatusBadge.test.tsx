import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GoogleDriveStatusBadge from "./GoogleDriveStatusBadge";
import * as googleDriveAuth from "../../context/GoogleDriveAuthContext";

vi.mock("../../context/GoogleDriveAuthContext");

const mockedUseAuth = vi.mocked(googleDriveAuth.useGoogleDriveAuth);

function renderBadge(overrides: Partial<ReturnType<typeof googleDriveAuth.useGoogleDriveAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    isConnected: false,
    email: null,
    connectedAt: null,
    isLoading: false,
    refetchStatus: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isDisconnecting: false,
    ...overrides,
  });

  return render(<GoogleDriveStatusBadge />);
}

describe("GoogleDriveStatusBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hiển thị spinner khi đang loading", () => {
    renderBadge({ isLoading: true });
    expect(screen.getByText("Đang kiểm tra...")).toBeInTheDocument();
  });

  it("hiển thị 'Đã kết nối' với màu xanh khi connected", () => {
    renderBadge({ isConnected: true });

    const badge = screen.getByText("Đã kết nối");
    expect(badge).toBeInTheDocument();
    expect(badge.closest("span")).toHaveClass("text-success-600");
  });

  it("hiển thị 'Chưa kết nối' với màu xám khi disconnected", () => {
    renderBadge({ isConnected: false });

    const badge = screen.getByText("Chưa kết nối");
    expect(badge).toBeInTheDocument();
    expect(badge.closest("span")).toHaveClass("text-gray-600");
  });
});
