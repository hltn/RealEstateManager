import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Loader2,
  ExternalLink,
  AlertCircle,
  RotateCcw,
  Upload,
} from "lucide-react";
import { exportToGoogleDrive } from "../../api/google-drive.api";
import { useGoogleDriveAuth } from "../../context/GoogleDriveAuthContext";
import type { GoogleDriveExportResult } from "../../api/google-drive.api";

type ExportStatus = "idle" | "exporting" | "success" | "error";

interface GoogleDriveExport {
  documentId: string;
  documentUrl: string;
  title: string;
  exportedAt: string; // API trả về string từ server
}

interface ExportButtonProps {
  /** ID của MarketAnalysisHistory record cần export. */
  historyId: string;
  /** Thông tin export Google Drive từ lịch sử (nếu đã export). */
  googleDriveExport?: GoogleDriveExport | null;
  /** Callback khi cần mở folder input (parent component quản lý). */
  onShowFolderInput?: () => void;
  /** Callback khi export thành công để cập nhật parent state. */
  onExportSuccess?: (result: GoogleDriveExportResult) => void;
}

/**
 * Button export Market Analysis lên Google Drive.
 *
 * States:
 * - idle: Hiển thị "Export" (blue) hoặc disabled nếu chưa connect
 * - exporting: Spinner + "Đang export..."
 * - success: "Đã export!" + link mở Google Doc
 * - error: Thông báo lỗi + nút retry
 */
const ExportButton: React.FC<ExportButtonProps> = ({
  historyId,
  googleDriveExport,
  onShowFolderInput,
  onExportSuccess,
}) => {
  const { isConnected } = useGoogleDriveAuth();
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportResult, setExportResult] = useState<GoogleDriveExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const exportMutation = useMutation({
    mutationFn: () => exportToGoogleDrive(historyId),
    onSuccess: (result) => {
      setExportStatus("success");
      setExportResult(result);
      // Notify parent component about export success
      if (onExportSuccess) {
        onExportSuccess(result);
      }
    },
    onError: (err: any) => {
      setExportStatus("error");
      const message =
        err?.response?.data?.message ??
        err?.message ??
        "Export thất bại. Vui lòng thử lại.";
      setErrorMessage(message);
    },
  });

  const handleExport = useCallback(() => {
    setExportStatus("exporting");
    setErrorMessage(null);
    setExportResult(null);
    exportMutation.mutate();
  }, [exportMutation]);

  const handleRetry = useCallback(() => {
    setExportStatus("idle");
    setErrorMessage(null);
    setExportResult(null);
    // Trigger re-export immediately
    setExportStatus("exporting");
    exportMutation.mutate();
  }, [exportMutation]);

  const handleReExport = useCallback(() => {
    setExportStatus("exporting");
    setErrorMessage(null);
    setExportResult(null);
    // When re-exporting, we don't clear googleDriveExport immediately
    // It will be updated when export succeeds via the callback
    exportMutation.mutate();
  }, [exportMutation]);

  // State: Disconnected
  if (!isConnected) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-gray-400 bg-gray-100 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed opacity-60"
        title="Kết nối Google Drive trước khi export"
      >
        <Upload className="w-4 h-4" />
        Export
      </button>
    );
  }

  // State: Exporting
  if (exportStatus === "exporting") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-blue-700 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300 cursor-not-allowed"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Đang export...
      </button>
    );
  }

  // State: Error - ưu tiên hơn Success để export (lại) thất bại không bị che bởi badge "Đã export!".
  // Nếu mục đã từng export thì vẫn giữ link "Mở Drive" cũ bên cạnh thông báo lỗi.
  if (exportStatus === "error") {
    const previousExport = googleDriveExport ?? null;
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          {errorMessage && (
            <span className="max-w-[200px] truncate" title={errorMessage}>
              {errorMessage}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Thử lại
        </button>
        {previousExport && (
          <a
            href={previousExport.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline underline-offset-2"
          >
            Mở Drive
          </a>
        )}
      </div>
    );
  }

  // State: Success - ưu tiên kết quả export vừa xong, fallback về lịch sử export từ server.
  // `exportResult` chỉ được set khi mutation thành công nên không cần kiểm tra thêm exportStatus.
  const exportData = exportResult?.data ?? googleDriveExport ?? null;
  if (exportData) {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300">
          <ExternalLink className="w-4 h-4" />
          Đã export!
        </span>
        <a
          href={exportData.documentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline underline-offset-2"
        >
          Mở Drive
        </a>
        <button
          type="button"
          onClick={handleReExport}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Export lại"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // State: Idle (connected) - chưa export hoặc đã reset
  return (
    <button
      type="button"
      onClick={onShowFolderInput ?? handleExport}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-brand-700 dark:text-brand-300 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 transition-colors"
    >
      <Upload className="w-4 h-4" />
      Export
    </button>
  );
};

export default ExportButton;
