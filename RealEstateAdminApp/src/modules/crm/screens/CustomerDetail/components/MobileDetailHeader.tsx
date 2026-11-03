// Hàng "← Quay lại" + nhãn mục cha của màn chi tiết (Mobile CustomerDetailView).
// Nằm TRONG nội dung (không sticky/fixed): header + drawer phía trên là `AppHeader`/`AppSidebar` của Admin,
// nên không vẽ thêm top app bar thứ hai như bản Stitch.
// PT-017: KHÔNG hiện tên khách ở đây (tên dài chiếm chỗ trên màn hẹp, và đã có ở thẻ tóm tắt hồ sơ `CustomerHeader` ngay bên dưới).
// PT-029: KHÔNG có nút "Chỉnh sửa" ở góc phải (đứng lửng lơ ngoài thẻ); lối vào `edit_persona` còn ở nút "Sửa" của thẻ "Thông tin" và "Chân dung khách hàng".
import { ArrowLeft } from 'lucide-react';
import { useCrmActions } from '@crm/store';

export const MobileDetailHeader = () => {
  const { goBack } = useCrmActions();

  return (
    <div className="flex items-center">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Quay lại"
          title="Quay lại"
          onClick={goBack}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition hover:bg-gray-50 active:scale-95 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <p className="truncate text-base font-semibold text-gray-800 dark:text-white/90">Quản lý khách hàng</p>
      </div>
    </div>
  );
};
