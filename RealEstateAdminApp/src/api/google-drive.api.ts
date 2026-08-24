import apiAxios from "./axios";

/** Phản hồi từ `GET /google-drive/status`. */
export interface GoogleDriveStatus {
  connected: boolean;
  email?: string;
  connectedAt?: string;
}

/** Phản hồi từ `GET /google-drive/auth/url`. */
export interface GoogleDriveAuthUrlResponse {
  url: string;
}

/** Phản hồi từ `POST /google-drive/export/:historyId`. */
export interface GoogleDriveExportResult {
  message: string;
  data: {
    documentId: string;
    documentUrl: string;
    title: string;
    folderUrl?: string;
  };
}

/** Phản hồi từ `POST /google-drive/folder/validate`. */
export interface GoogleDriveFolderValidation {
  valid: boolean;
  folderName?: string;
  folderId?: string;
  message?: string;
}

/**
 * Lấy URL OAuth để redirect user sang Google consent screen.
 * `GET /google-drive/auth/url`
 */
export async function getGoogleDriveAuthUrl(
  signal?: AbortSignal,
): Promise<string> {
  const { data } = await apiAxios.get<GoogleDriveAuthUrlResponse>(
    "/google-drive/auth/url",
    { signal },
  );
  return data.url;
}

/**
 * Kiểm tra user đã kết nối Google Drive chưa.
 * `GET /google-drive/status`
 */
export async function getGoogleDriveStatus(
  signal?: AbortSignal,
): Promise<GoogleDriveStatus> {
  const { data } = await apiAxios.get<GoogleDriveStatus>(
    "/google-drive/status",
    { signal },
  );
  return data;
}

/**
 * Export 1 Market Analysis History record lên Google Drive.
 * `POST /google-drive/export/:historyId`
 */
export async function exportToGoogleDrive(
  historyId: string,
  folderUrl?: string,
): Promise<GoogleDriveExportResult> {
  const { data } = await apiAxios.post<GoogleDriveExportResult>(
    `/google-drive/export/${historyId}`,
    folderUrl ? { folderUrl } : {},
  );
  return data;
}

/**
 * Ngắt kết nối Google Drive — xóa token, revoke trên Google.
 * `DELETE /google-drive/disconnect`
 */
export async function disconnectGoogleDrive(): Promise<{ message: string }> {
  const { data } = await apiAxios.delete<{ message: string }>(
    "/google-drive/disconnect",
  );
  return data;
}

/**
 * Validate folder URL — kiểm tra user có quyền truy cập folder không.
 * `POST /google-drive/folder/validate`
 */
export async function validateGoogleDriveFolder(
  folderUrl: string,
): Promise<GoogleDriveFolderValidation> {
  const { data } = await apiAxios.post<GoogleDriveFolderValidation>(
    "/google-drive/folder/validate",
    { folderUrl },
  );
  return data;
}
