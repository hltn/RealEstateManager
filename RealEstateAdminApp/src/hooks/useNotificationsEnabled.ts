import { CRM_FEATURE_FLAGS } from "@crm/config/featureFlags";
import { hasCrmRole } from "../utils/userRoles";
import { useAuth } from "./useAuth";

/**
 * Thông báo trong app có dùng được không: module CRM bật VÀ người dùng có quyền CRM
 * (EDITOR thuần không có quyền CRM: backend trả 403). Dùng chung cho chuông (NotificationDropdown)
 * và chấm đỏ trên nút ba chấm của header mobile (AppHeader) để hai nơi không lệch điều kiện.
 */
export function useNotificationsEnabled(): boolean {
  const { user } = useAuth();
  return CRM_FEATURE_FLAGS.isPrototypeEnabled && hasCrmRole(user);
}
