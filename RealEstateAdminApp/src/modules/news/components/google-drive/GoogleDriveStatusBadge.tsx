import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useGoogleDriveAuth } from "../../context/GoogleDriveAuthContext";

/**
 * Badge hiển thị trạng thái kết nối Google Drive.
 * - Connected: badge xanh + icon check
 * - Disconnected: badge xám + icon X
 * - Loading: spinner
 */
const GoogleDriveStatusBadge: React.FC = () => {
  const { isConnected, isLoading } = useGoogleDriveAuth();

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Đang kiểm tra...
      </span>
    );
  }

  if (isConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-medium bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500">
        <CheckCircle2 className="w-4 h-4" />
        Đã kết nối
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-white/80">
      <XCircle className="w-4 h-4" />
      Chưa kết nối
    </span>
  );
};

export default GoogleDriveStatusBadge;
