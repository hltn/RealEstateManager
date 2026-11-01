import { SetMetadata } from '@nestjs/common';

export const ANY_ROLE_KEY = 'anyRole';

/**
 * @AnyRole() — route dành cho MỌI người dùng đã đăng nhập (ADMIN, EDITOR, MANAGER, STAFF),
 * ví dụ `/auth/me`, `/auth/logout`.
 *
 * `RolesGuard` là default-deny: route KHÔNG có `@Roles`/`@Public`/`@AnyRole` chỉ cho ADMIN và EDITOR
 * (nhân sự nội bộ có từ trước CRM). Vai trò CRM (MANAGER/STAFF) muốn vào route nào phải được khai báo
 * tường minh bằng `@Roles(...)` hoặc `@AnyRole()`. Chỉ dùng cho route không lộ dữ liệu/hành động nhạy cảm.
 */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
