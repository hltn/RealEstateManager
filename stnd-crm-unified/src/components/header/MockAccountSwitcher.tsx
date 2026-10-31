import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useCrmRawState } from "@crm/store/hooks";
import { useAuth } from "../../hooks/useAuth";
import { MOCK_ACCESS_TOKEN, toAuthUser } from "../../mocks/mockUser";
import { hasCrmRole } from "../../utils/userRoles";

/** Tiền tố khoá localStorage của prototype — CHỈ xoá khoá có tiền tố này (khoá khác, vd của app chính, không đụng tới). */
const PROTOTYPE_STORAGE_PREFIX = "stnd_crm_proto_";

/** Xóa dữ liệu CRM mẫu đã lưu (mọi khoá `stnd_crm_proto_*`: dữ liệu, phiên, kho CCCD mô phỏng, bản sao lưu) rồi tải lại để nạp bộ dữ liệu ban đầu. */
export const resetPrototypeData = (): void => {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PROTOTYPE_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Bỏ qua: không có localStorage thì dữ liệu vốn không được lưu.
  }
  window.location.reload();
};

interface MockAccountSwitcherProps {
  /** Đóng dropdown cha sau khi chọn. */
  onDone: () => void;
  /** Người dùng bấm "Đặt lại dữ liệu mẫu": cha hiện hộp xác nhận (hộp nằm ngoài dropdown để không bị gỡ khi dropdown đóng). */
  onResetRequest: () => void;
}

/**
 * [Prototype] Bộ chuyển "Tài khoản mẫu": đổi người đăng nhập giả để duyệt giao diện theo vai trò (Quản trị / Quản lý / Nhân viên / nhiều
 * vai trò / chỉ Biên tập) và nút "Đặt lại dữ liệu mẫu". KHÔNG có ở app chính (app chính đăng nhập thật qua `/login`).
 * Đổi tài khoản = ghi lại phiên (`setAuth`) từ hồ sơ trong store CRM nên phạm vi dữ liệu, menu và quyền thay đổi ngay, không tải lại trang.
 */
export default function MockAccountSwitcher({ onDone, onResetRequest }: MockAccountSwitcherProps) {
  const { users, teams } = useCrmRawState();
  const { user, setAuth } = useAuth();
  const navigate = useNavigate();

  const switchTo = (userId: string) => {
    const account = users.find((item) => item.id === userId);
    if (!account || !account.isActive || account.id === user?._id) return;
    const authUser = toAuthUser(account, teams);
    setAuth(MOCK_ACCESS_TOKEN, authUser);
    onDone();
    navigate(hasCrmRole(authUser) ? "/crm/today" : "/raw-articles", { replace: true });
    toast.success(`Đang xem với tài khoản ${account.displayName}`);
  };

  return (
    <div className="border-b border-gray-200 py-3 dark:border-gray-800" data-testid="mock-account-switcher">
      <p className="px-3 pb-1 text-theme-xs font-medium uppercase text-gray-500 dark:text-gray-400">Tài khoản mẫu [Prototype]</p>
      <ul className="custom-scrollbar flex max-h-52 flex-col gap-0.5 overflow-y-auto">
        {users.map((account) => {
          const isCurrent = account.id === user?._id;
          return (
            <li key={account.id}>
              <button
                type="button"
                disabled={!account.isActive}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => switchTo(account.id)}
                className={`flex w-full flex-col rounded-lg px-3 py-1.5 text-left text-theme-sm transition ${
                  isCurrent
                    ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                    : "text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                <span className="font-medium">
                  {account.displayName}
                  {!account.isActive ? " (đã khóa)" : ""}
                </span>
                <span className="text-theme-xs text-gray-500 dark:text-gray-400">{account.roles.join(" + ")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onResetRequest}
        className="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-theme-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
      >
        Đặt lại dữ liệu mẫu
      </button>
    </div>
  );
}
