/** Toast cho trang Thông báo (nằm ngoài `CrmProvider`): dùng `react-hot-toast` toàn cục của app. */
import hotToast from 'react-hot-toast';

export const toast = { success: (message: string) => hotToast.success(message), error: (message: string) => hotToast.error(message) };
