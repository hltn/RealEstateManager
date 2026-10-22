/**
 * Hộp xác nhận dùng chung (vd đổi tình trạng sang "Bỏ" — tài liệu 02 §5) trên vỏ `Modal` của Admin.
 */
import type { ReactNode } from 'react';
import { Modal } from '../../../components/ui/modal';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Tông nút xác nhận: nguy hiểm (đỏ) cho thao tác như chuyển sang "Bỏ". */
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

const DANGER_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-error-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-error-600';

export const ConfirmDialog = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Huỷ',
  tone = 'primary',
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) => (
  <Modal isOpen={isOpen} onClose={onCancel} showCloseButton={false} className="mx-4 max-w-md">
    <div role="alertdialog" aria-modal="true" aria-labelledby="crm-confirm-title" className="space-y-4 p-6">
      <h3 id="crm-confirm-title" className="text-lg font-semibold text-gray-800 dark:text-white/90">
        {title}
      </h3>
      <div className="text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</div>
      {children}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className={BUTTON_OUTLINE_CLASS}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} className={tone === 'danger' ? DANGER_BUTTON_CLASS : BUTTON_PRIMARY_CLASS}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </Modal>
);
