import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExportButton from "./ExportButton";
import * as googleDriveAuth from "../../context/GoogleDriveAuthContext";

vi.mock("../../context/GoogleDriveAuthContext");

const mockedUseAuth = vi.mocked(googleDriveAuth.useGoogleDriveAuth);

interface GoogleDriveExport {
  documentId: string;
  documentUrl: string;
  title: string;
  exportedAt: string;
}

function renderWithGoogleDriveExport(
  googleDriveExport?: GoogleDriveExport | null,
  isConnected = true
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  mockedUseAuth.mockReturnValue({
    isConnected,
    email: "user@gmail.com",
    connectedAt: "2024-01-01T00:00:00.000Z",
    isLoading: false,
    refetchStatus: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isDisconnecting: false,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ExportButton
        historyId="hist123"
        googleDriveExport={googleDriveExport}
      />
    </QueryClientProvider>,
  );
}

describe("ExportButton with Google Drive Export Status", () => {
  describe("when googleDriveExport is provided", () => {
    const mockExportData: GoogleDriveExport = {
      documentId: "doc123",
      documentUrl: "https://docs.google.com/document/d/doc123/edit",
      title: "Market Analysis Report",
      exportedAt: "2024-01-15T10:30:00.000Z",
    };

    it("shows 'ĐÃ EXPORT!' badge with external link icon", () => {
      renderWithGoogleDriveExport(mockExportData);

      expect(screen.getByText(/đã export!/i)).toBeInTheDocument();
      const badge = screen.getByRole("button", { name: /đã export!/i });
      expect(badge).toHaveClass("text-emerald-700");
      expect(badge).toHaveClass("bg-emerald-50");
    });

    it("shows 'Mở Drive' link with correct attributes", () => {
      renderWithGoogleDriveExport(mockExportData);

      const link = screen.getByText("Mở Drive");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", mockExportData.documentUrl);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("shows 'Export lại' button with rotate icon", () => {
      renderWithGoogleDriveExport(mockExportData);

      const button = screen.getByRole("button", { name: /export lại/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass("text-gray-400");
      expect(button).toHaveClass("hover:text-gray-600");
    });

    it("does not show 'Export' button", () => {
      renderWithGoogleDriveExport(mockExportData);

      expect(screen.queryByText("Export")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
    });

    it("clicking 'Export lại' button does not crash', () => {
      renderWithGoogleDriveExport(mockExportData);

      const button = screen.getByRole("button", { name: /export lại/i });
      expect(() => fireEvent.click(button)).not.toThrow();
    });
  });

  describe("when googleDriveExport is null", () => {
    it("shows 'Export' button when connected", () => {
      renderWithGoogleDriveExport(null);

      const button = screen.getByRole("button", { name: /export/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("Export");
    });

    it("shows disabled state when not connected", () => {
      renderWithGoogleDriveExport(null, false);

      const button = screen.getByRole("button", { name: /export/i });
      expect(button).toBeDisabled();
    });
  });

  describe("edge cases", () => {
    it("handles empty documentUrl gracefully", () => {
      const mockExportData: GoogleDriveExport = {
        documentId: "doc123",
        documentUrl: "",
        title: "Report",
        exportedAt: "2024-01-15T10:30:00.000Z",
      };

      renderWithGoogleDriveExport(mockExportData);

      const link = screen.getByText("Mở Drive");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "");
    });

    it("handles missing title gracefully", () => {
      const mockExportData: GoogleDriveExport = {
        documentId: "doc123",
        documentUrl: "https://docs.google.com/document/d/doc123/edit",
        title: "",
        exportedAt: "2024-01-15T10:30:00.000Z",
      };

      renderWithGoogleDriveExport(mockExportData);

      // Component should still render without errors
      expect(screen.getByText(/đã export!/i)).toBeInTheDocument();
    });
  });
});