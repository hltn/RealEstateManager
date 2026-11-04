import { useEffect } from 'react';
import toast from 'react-hot-toast';
import PwaToastCard from './PwaToastCard';
import { registerServiceWorker } from './registerServiceWorker';

/** Id cố định để không bao giờ hiện 2 toast "Có phiên bản mới" chồng nhau. */
const UPDATE_TOAST_ID = 'pwa-update-available';

/**
 * Đăng ký service worker và hiện toast khi có bản mới (không render gì trong cây UI).
 * KHÔNG tự reload: chỉ gọi applyUpdate khi người dùng bấm "Cập nhật". Chỉ hoạt động ở bản production.
 */
const PwaUpdatePrompt = () => {
  useEffect(() => {
    return registerServiceWorker((applyUpdate) => {
      toast.custom(
        (toastState) => (
          <PwaToastCard
            toastState={toastState}
            title="Có phiên bản mới"
            description="Cập nhật sẽ tải lại ứng dụng, hãy lưu phần đang nhập trước."
            dismissLabel="Để sau"
            confirmLabel="Cập nhật"
            onConfirm={() => {
              toast.dismiss(UPDATE_TOAST_ID);
              void applyUpdate();
            }}
          />
        ),
        { id: UPDATE_TOAST_ID, duration: Infinity },
      );
    });
  }, []);

  return null;
};

export default PwaUpdatePrompt;
