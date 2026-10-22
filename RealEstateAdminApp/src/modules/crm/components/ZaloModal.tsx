/**
 * Gửi tin Zalo ZNS theo mẫu - port từ Admin `src/components/ZaloModal.tsx`.
 * Chỉ mở trên web; trên app, `useContactActions().messageZalo` hiện toast (hành vi Mobile).
 * Vỏ = `components/ui/modal` của Admin; đầu hộp thoại theo mẫu Admin (`px-6 py-4 border-b` + `h3.text-lg`)
 * thay dải gradient xanh/indigo của Stitch; nút gửi màu success (cùng màu nút Zalo ở bảng/thẻ).
 */
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Paperclip, Send, X } from 'lucide-react';
import { Modal } from '../../../components/ui/modal';
import { BUTTON_OUTLINE_CLASS, FORM_LABEL_CLASS, ICON_BUTTON_CLASS, MODAL_INPUT_CLASS } from '@crm/lib/uiClasses';

export const ZALO_SEND_DELAY_MS = 1200;

const TITLE_ID = 'crm-zalo-modal-title';

/** Mẫu tin nhắn theo cách xưng hô ưu tiên của khách (fallback "anh <tên>"). */
export const buildZaloTemplates = (customer: ContactTarget): string[] => {
  const salutation = customer.preferredSalutation || `anh ${customer.name}`;
  const projectName = customer.interestedProjects[0] ?? "Q'Terra";
  const staffName = customer.staffName ?? 'em';
  return [
    `Chào ${salutation}, em ${staffName} bên BĐS STND xin gửi bảng tính dòng tiền và phương án vay hỗ trợ 40% cho căn hộ dự án ${projectName}. ${salutation} xem qua và báo em nếu cần hỗ trợ thêm nhé ạ!`,
    `Dạ ${salutation}, cuối tuần này bên em có chương trình trải nghiệm sa bàn và căn hộ mẫu ${projectName}. Em xin phép gửi vé mời ${salutation} và gia đình ghé tham quan ạ!`,
    `Em ${staffName} STND gửi ${salutation} cập nhật mới nhất về tiến độ pháp lý đợt 2 và danh mục vật liệu bàn giao của căn hộ ạ.`,
  ];
};

/** Thông tin tối thiểu của khách cho modal (cờ tính năng giai đoạn sau). */
export interface ContactTarget {
  name: string;
  phone: string;
  preferredSalutation: string;
  interestedProjects: string[];
  staffName?: string;
}

export interface ZaloMessageInput {
  message: string;
}

interface ZaloModalProps {
  customer: ContactTarget;
  onClose: () => void;
  onSent: (input: ZaloMessageInput) => void;
}

export const ZaloModal = ({ customer, onClose, onSent }: ZaloModalProps) => {
  const [templates] = useState(() => buildZaloTemplates(customer));
  const [message, setMessage] = useState(templates[0]);
  const [isSending, setIsSending] = useState(false);
  const sendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectName = customer.interestedProjects[0] ?? "Q'Terra";
  const canSend = message.trim().length > 0 && !isSending;

  useEffect(
    () => () => {
      if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
    },
    [],
  );

  // Mô phỏng độ trễ gửi tin rồi ghi nhật ký + đóng modal.
  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isSending) return;
    setIsSending(true);
    sendTimeoutRef.current = setTimeout(() => {
      onSent({ message: trimmedMessage });
      onClose();
    }, ZALO_SEND_DELAY_MS);
  };

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-lg overflow-hidden">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-3">
            {/* Logo "Z" giữ màu nhận diện Zalo (token blue-light của Admin) */}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-light-500 text-lg font-bold text-white">
              Z
            </span>
            <div className="min-w-0">
              <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Gửi tin nhắn Zalo ZNS / Tư vấn
              </h3>
              <p className="truncate text-theme-sm text-gray-500 dark:text-gray-400">
                Gửi tới: <span className="font-medium text-gray-700 dark:text-gray-300">{customer.name}</span> ({customer.phone})
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className={ICON_BUTTON_CLASS}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-4 p-6">
          <div>
            <span className={FORM_LABEL_CLASS}>Mẫu tin nhắn nhanh</span>
            <div className="space-y-2">
              {templates.map((template, index) => {
                const isSelected = message === template;
                return (
                  <button
                    key={template}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setMessage(template)}
                    className={`flex w-full items-baseline gap-1.5 rounded-lg border p-2.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className="shrink-0 font-semibold text-brand-500 dark:text-brand-400">Mẫu {index + 1}:</span>
                    <span className="line-clamp-1">{template}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="zalo-message" className={FORM_LABEL_CLASS}>
              Nội dung tin nhắn
            </label>
            <textarea
              id="zalo-message"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className={`${MODAL_INPUT_CLASS} resize-none leading-relaxed`}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-gray-400">
            <div className="flex min-w-0 items-center gap-2">
              <Paperclip size={16} className="shrink-0" aria-hidden="true" />
              <span className="truncate">Đính kèm: Bang-tinh-dong-tien-{projectName}.pdf (1.8MB)</span>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-success-600 dark:text-success-500">
              <CircleCheck size={14} aria-hidden="true" />
              Sẵn sàng
            </span>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-theme-xs text-gray-400 dark:text-gray-500">Người gửi: {(customer.staffName ?? 'em')}</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className={`${BUTTON_OUTLINE_CLASS} flex-1 sm:flex-none`}>
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={handleSend}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-success-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {isSending ? (
                  <>
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Đang gửi...
                  </>
                ) : (
                  <>
                    <Send size={16} aria-hidden="true" />
                    Gửi Zalo ngay
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
