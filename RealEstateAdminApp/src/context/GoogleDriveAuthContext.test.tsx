import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GoogleDriveAuthProvider,
  useGoogleDriveAuth,
} from "./GoogleDriveAuthContext";
import apiAxios from "../api/axios";

vi.mock("../api/axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = apiAxios as unknown as { get: ReturnType<typeof vi.fn> };

/** Component test helper — render một component consume context. */
function TestConsumer(): React.FC {
  function Inner() {
    const { isConnected, email, isLoading } = useGoogleDriveAuth();
    return (
      <div>
        <span data-testid="loading">{String(isLoading)}</span>
        <span data-testid="connected">{String(isConnected)}</span>
        <span data-testid="email">{email ?? "null"}</span>
      </div>
    );
  }
  return Inner;
}

function renderWithProvider(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GoogleDriveAuthProvider>{ui}</GoogleDriveAuthProvider>
    </QueryClientProvider>,
  );
}

describe("GoogleDriveAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trạng thái mặc định khi API trả connected=false", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { connected: false },
    });

    const Consumer = TestConsumer();
    renderWithProvider(<Consumer />);

    // Sau khi API resolve, isLoading = false, connected = false
    expect(await screen.findByTestId("connected")).toHaveTextContent("false");
    expect(screen.getByTestId("email")).toHaveTextContent("null");
  });

  it("hiển thị email khi API trả connected=true", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        connected: true,
        email: "user@gmail.com",
        connectedAt: "2026-08-15T10:30:00.000Z",
      },
    });

    const Consumer = TestConsumer();
    renderWithProvider(<Consumer />);

    // Đợi cho query resolve và state update
    await waitFor(() => {
      expect(screen.getByTestId("connected")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("email")).toHaveTextContent("user@gmail.com");
  });

  it("trả connected=false khi API call thất bại", async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

    const Consumer = TestConsumer();
    renderWithProvider(<Consumer />);

    expect(await screen.findByTestId("connected")).toHaveTextContent("false");
  });

  it("useGoogleDriveAuth throw khi không có Provider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function BadConsumer() {
      useGoogleDriveAuth();
      return null;
    }

    expect(() => render(<BadConsumer />)).toThrow(
      "useGoogleDriveAuth must be used within a GoogleDriveAuthProvider",
    );
    consoleSpy.mockRestore();
  });
});
