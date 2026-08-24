import { describe, it, expect, vi, beforeEach } from "vitest";
import apiAxios from "./axios";
import {
  getGoogleDriveAuthUrl,
  getGoogleDriveStatus,
  exportToGoogleDrive,
  disconnectGoogleDrive,
  validateGoogleDriveFolder,
} from "./google-drive.api";

vi.mock("./axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedAxios = apiAxios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe("google-drive.api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getGoogleDriveAuthUrl", () => {
    it("trả về auth URL từ GET /google-drive/auth/url", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { url: "https://accounts.google.com/o/oauth2/v2/auth?..." },
      });

      const url = await getGoogleDriveAuthUrl();
      expect(url).toBe("https://accounts.google.com/o/oauth2/v2/auth?...");
      expect(mockedAxios.get).toHaveBeenCalledWith("/google-drive/auth/url", {
        signal: undefined,
      });
    });

    it("forward AbortSignal cho request", async () => {
      const signal = new AbortController().signal;
      mockedAxios.get.mockResolvedValueOnce({ data: { url: "ok" } });

      await getGoogleDriveAuthUrl(signal);
      expect(mockedAxios.get).toHaveBeenCalledWith("/google-drive/auth/url", {
        signal,
      });
    });
  });

  describe("getGoogleDriveStatus", () => {
    it("trả về trạng thái connected khi user đã authorize", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          connected: true,
          email: "user@gmail.com",
          connectedAt: "2026-08-15T10:30:00.000Z",
        },
      });

      const status = await getGoogleDriveStatus();
      expect(status.connected).toBe(true);
      expect(status.email).toBe("user@gmail.com");
      expect(status.connectedAt).toBe("2026-08-15T10:30:00.000Z");
    });

    it("trả về trạng thái disconnected khi chưa authorize", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { connected: false },
      });

      const status = await getGoogleDriveStatus();
      expect(status.connected).toBe(false);
    });
  });

  describe("exportToGoogleDrive", () => {
    it("gọi POST /google-drive/export/:historyId với body rỗng khi không có folderUrl", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          message: "Export successful",
          data: {
            documentId: "abc123",
            documentUrl: "https://docs.google.com/document/d/abc123/edit",
            title: "Report",
          },
        },
      });

      const result = await exportToGoogleDrive("hist123");
      expect(result.data.documentId).toBe("abc123");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/google-drive/export/hist123",
        {},
      );
    });

    it("gọi POST với folderUrl khi có truyền", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          message: "Export successful",
          data: {
            documentId: "abc123",
            documentUrl: "https://docs.google.com/document/d/abc123/edit",
            title: "Report",
            folderUrl: "https://drive.google.com/drive/folders/xyz",
          },
        },
      });

      const result = await exportToGoogleDrive(
        "hist123",
        "https://drive.google.com/drive/folders/xyz",
      );
      expect(result.data.folderUrl).toBe(
        "https://drive.google.com/drive/folders/xyz",
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/google-drive/export/hist123",
        { folderUrl: "https://drive.google.com/drive/folders/xyz" },
      );
    });
  });

  describe("disconnectGoogleDrive", () => {
    it("gọi DELETE /google-drive/disconnect", async () => {
      mockedAxios.delete.mockResolvedValueOnce({
        data: { message: "Google Drive disconnected successfully" },
      });

      const result = await disconnectGoogleDrive();
      expect(result.message).toBe("Google Drive disconnected successfully");
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "/google-drive/disconnect",
      );
    });
  });

  describe("validateGoogleDriveFolder", () => {
    it("gọi POST /google-drive/folder/validate và trả kết quả valid", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: true,
          folderName: "Reports",
          folderId: "abc123",
        },
      });

      const result = await validateGoogleDriveFolder(
        "https://drive.google.com/drive/folders/abc123",
      );
      expect(result.valid).toBe(true);
      expect(result.folderName).toBe("Reports");
    });

    it("trả kết quả invalid khi folder không accessible", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: false,
          message: "Folder not found or not accessible",
        },
      });

      const result = await validateGoogleDriveFolder(
        "https://drive.google.com/drive/folders/invalid",
      );
      expect(result.valid).toBe(false);
      expect(result.message).toBe("Folder not found or not accessible");
    });
  });
});
