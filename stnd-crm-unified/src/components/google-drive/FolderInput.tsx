import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Loader2, FolderOpen } from "lucide-react";
import { validateGoogleDriveFolder } from "../../api/google-drive.api";

interface FolderInputProps {
  /** Callback khi user xác nhận folder URL. */
  onConfirm: (folderUrl: string) => void;
  /** Callback khi user hủy. */
  onCancel: () => void;
  /** true trong lúc export đang chạy (để disable input). */
  isExporting: boolean;
}

/**
 * Input field cho Google Drive folder URL + nút validate.
 *
 * Flow:
 * 1. User nhập/paste folder URL
 * 2. Validate onBlur hoặc khi paste
 * 3. Hiển thị tên folder nếu valid
 * 4. User bấm "Export" để confirm
 */
const FolderInput: React.FC<FolderInputProps> = ({
  onConfirm,
  onCancel,
  isExporting,
}) => {
  const [folderUrl, setFolderUrl] = useState("");
  const [validationResult, setValidationResult] = useState<{
    status: "idle" | "validating" | "valid" | "invalid";
    folderName?: string;
    message?: string;
  }>({ status: "idle" });

  const validateMutation = useMutation({
    mutationFn: validateGoogleDriveFolder,
    onSuccess: (result) => {
      if (result.valid) {
        setValidationResult({
          status: "valid",
          folderName: result.folderName,
        });
      } else {
        setValidationResult({
          status: "invalid",
          message: result.message ?? "Folder không hợp lệ",
        });
      }
    },
    onError: () => {
      setValidationResult({
        status: "invalid",
        message: "Không thể validate folder. Vui lòng thử lại.",
      });
    },
  });

  const handleValidate = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) {
        setValidationResult({ status: "idle" });
        return;
      }
      setValidationResult({ status: "validating" });
      validateMutation.mutate(trimmed);
    },
    [validateMutation],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      handleValidate(e.target.value);
    },
    [handleValidate],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      // Delay validate để giá trị paste cập nhật trước
      setTimeout(() => {
        const target = e.target as HTMLInputElement;
        handleValidate(target.value);
      }, 0);
    },
    [handleValidate],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(folderUrl.trim());
  }, [folderUrl, onConfirm]);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
        <FolderOpen className="w-3.5 h-3.5 inline mr-1" />
        Folder URL (tùy chọn):
      </label>
      <input
        type="url"
        value={folderUrl}
        onChange={(e) => {
          setFolderUrl(e.target.value);
          // Reset validation khi user thay đổi giá trị
          if (validationResult.status !== "idle") {
            setValidationResult({ status: "idle" });
          }
        }}
        onBlur={handleBlur}
        onPaste={handlePaste}
        placeholder="https://drive.google.com/drive/folders/..."
        disabled={isExporting}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
      />

      {/* Validation feedback */}
      {validationResult.status === "validating" && (
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Đang kiểm tra folder...
        </span>
      )}
      {validationResult.status === "valid" && validationResult.folderName && (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Folder: {validationResult.folderName}
        </span>
      )}
      {validationResult.status === "invalid" && (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <XCircle className="w-3.5 h-3.5" />
          {validationResult.message}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={isExporting}
          className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          Hủy
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isExporting || validationResult.status === "validating"}
          className="px-3 py-1.5 text-sm font-medium rounded-lg text-white bg-brand-500 hover:bg-brand-600 disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-gray-700 transition-colors"
        >
          Export
        </button>
      </div>
    </div>
  );
};

export default FolderInput;
