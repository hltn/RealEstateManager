/**
 * Selector thuần cấp state (người dùng hiện tại). Truy vấn nghiệp vụ (danh sách khách, việc hôm nay...)
 * nằm ở lớp truy cập dữ liệu `@crm/api/queries` để khớp endpoint tài liệu 05.
 */
import type { CrmUser } from '@crm/types/crm';
import type { CrmState } from './crmReducer';

/** Người dùng đang đăng nhập (mock). Không tìm thấy -> người dùng đầu tiên để giao diện không vỡ. */
export const selectCurrentUser = (state: Pick<CrmState, 'users' | 'session'>): CrmUser =>
  state.users.find((user) => user.id === state.session.currentUserId) ?? state.users[0];
