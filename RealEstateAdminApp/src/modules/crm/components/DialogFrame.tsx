/**
 * Khung hộp thoại dùng chung (vỏ `Modal` của Admin) có TRAP TIÊU ĐIỂM + `aria-labelledby`: Tab xoay vòng trong hộp, Esc/nền đóng,
 * đóng thì trả tiêu điểm về nút đã mở. Nội dung chỉ mount khi mở nên state của con tự reset mỗi lần mở.
 */
import { useId, type ReactNode } from 'react';
import { Modal } from '../../../components/ui/modal';
import { useFocusTrap } from '@crm/hooks/useFocusTrap';

interface DialogFrameProps {
  isOpen: boolean;
  title: string;
  /** `alertdialog` cho thao tác nguy hiểm/không hoàn tác. */
  role?: 'dialog' | 'alertdialog';
  /** Rộng hơn cho hộp có danh sách (kết quả từng khách). */
  size?: 'md' | 'lg';
  /** Nhấp nền có đóng hộp không (tắt khi người dùng đang nhập dở). */
  isBackdropClosable?: boolean;
  /** `id` của phần mô tả trong `children` (gắn `aria-describedby` để trình đọc màn hình đọc kèm). */
  describedById?: string;
  onClose: () => void;
  children: ReactNode;
}

const FrameBody = ({ title, role, describedById, children }: Pick<DialogFrameProps, 'title' | 'role' | 'describedById' | 'children'>) => {
  const containerRef = useFocusTrap<HTMLDivElement>();
  const titleId = useId();
  return (
    <div ref={containerRef} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={describedById} tabIndex={-1} className="space-y-4 p-5 outline-none sm:p-6">
      <h3 id={titleId} className="text-lg font-semibold text-gray-800 dark:text-white/90">
        {title}
      </h3>
      {children}
    </div>
  );
};

export const DialogFrame = ({ isOpen, title, role = 'dialog', size = 'md', isBackdropClosable = true, describedById, onClose, children }: DialogFrameProps) => (
  <Modal isOpen={isOpen} onClose={onClose} isBackdropClosable={isBackdropClosable} showCloseButton={false} className={`mx-4 ${size === 'lg' ? 'max-w-xl' : 'max-w-md'}`}>
    <FrameBody title={title} role={role} describedById={describedById}>
      {children}
    </FrameBody>
  </Modal>
);
