/**
 * Mô phỏng cuộc gọi + ghi nhật ký - port từ Admin `src/components/CallModal.tsx`.
 * Chỉ mở trên web; trên app, `useContactActions().callCustomer` mở `tel:` + toast (hành vi Mobile).
 * Vỏ = `components/ui/modal` của Admin; đầu hộp thoại giữ khối màu brand của Stitch (bỏ indigo),
 * phần form theo mẫu "form trong modal" (`UserManagementScreen.tsx:374-383`), đủ cặp `dark:`.
 */
import { useEffect, useState } from 'react';
import { Building, PhoneOff, Save } from 'lucide-react';
import { Modal } from '../../../components/ui/modal';
import {
  BUTTON_OUTLINE_CLASS,
  BUTTON_PRIMARY_CLASS,
  FORM_LABEL_CLASS,
  MODAL_INPUT_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';

export const CALL_OUTCOME_OPTIONS = [
  'Khách quan tâm giá / Cần gửi bảng tính',
  'Hẹn đi xem thực tế sa bàn và nhà mẫu',
  'Cần tư vấn thêm phương án vay 40%',
  'Chưa liên hệ được / Máy bận',
  'Khách không có nhu cầu',
] as const;

const TITLE_ID = 'crm-call-modal-title';

/** 75 -> "01:15". */
export const formatCallDuration = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/** Thông tin tối thiểu của khách cho modal (cờ tính năng giai đoạn sau). */
export interface ContactTarget {
  name: string;
  phone: string;
  preferredSalutation: string;
  interestedProjects: string[];
  staffName?: string;
}

export interface CallResultInput {
  note: string;
  callOutcome: string;
}

interface CallModalProps {
  customer: ContactTarget;
  onClose: () => void;
  onSaveLog: (input: CallResultInput) => void;
}

export const CallModal = ({ customer, onClose, onSaveLog }: CallModalProps) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCalling, setIsCalling] = useState(true);
  const [callOutcome, setCallOutcome] = useState<string>(CALL_OUTCOME_OPTIONS[0]);
  const [callNote, setCallNote] = useState('');
  const projectName = customer.interestedProjects[0] ?? "Q'Terra";

  // Đồng hồ đếm thời lượng cuộc gọi khi đang kết nối.
  useEffect(() => {
    if (!isCalling) return undefined;
    const timerId = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(timerId);
  }, [isCalling]);

  const handleSaveAndClose = () => {
    const note = callNote.trim() || `Cuộc gọi ${formatCallDuration(elapsedSeconds)} với ${customer.name}: ${callOutcome}`;
    onSaveLog({ note, callOutcome });
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-md overflow-hidden">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
        {/* Đầu: thẻ người gọi trên nền brand (giống nhau ở 2 chế độ sáng/tối) */}
        <div className="bg-gradient-to-br from-brand-600 to-brand-500 p-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-2xl font-semibold">
            {customer.name.charAt(0)}
          </div>
          <h3 id={TITLE_ID} className="text-xl font-semibold">
            {customer.name}
          </h3>
          <p className="mt-0.5 text-sm text-brand-100">{customer.phone}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-xs font-medium">
            <Building size={12} aria-hidden="true" />
            <span>Dự án: {projectName}</span>
          </div>
          <div className="mt-4" aria-live="polite">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                isCalling ? 'border-success-400/40 bg-success-500/25 text-white' : 'border-white/20 bg-black/20 text-white/80'
              }`}
            >
              <span aria-hidden="true" className="relative flex h-2 w-2">
                {isCalling && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400 opacity-75" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${isCalling ? 'bg-success-400' : 'bg-white/60'}`} />
              </span>
              {isCalling ? `Đang kết nối: ${formatCallDuration(elapsedSeconds)}` : `Đã kết thúc · ${formatCallDuration(elapsedSeconds)}`}
            </span>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label htmlFor="call-outcome" className={FORM_LABEL_CLASS}>
              Kết quả liên hệ
            </label>
            <select
              id="call-outcome"
              value={callOutcome}
              onChange={(event) => setCallOutcome(event.target.value)}
              className={SOLID_INPUT_CLASS}
            >
              {CALL_OUTCOME_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="call-note" className={FORM_LABEL_CLASS}>
              Ghi chú nhanh trong cuộc gọi
            </label>
            <textarea
              id="call-note"
              rows={3}
              value={callNote}
              onChange={(event) => setCallNote(event.target.value)}
              placeholder="Nhập ghi chú phản hồi, thắc mắc về giá, hướng căn, tiến độ thanh toán..."
              className={`${MODAL_INPUT_CLASS} resize-none`}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            {isCalling ? (
              <button
                type="button"
                onClick={() => setIsCalling(false)}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-error-500 text-sm font-medium text-white transition-colors hover:bg-error-600 active:scale-[0.98]"
              >
                <PhoneOff size={18} aria-hidden="true" />
                Kết thúc cuộc gọi
              </button>
            ) : (
              <>
                <button type="button" onClick={onClose} className={`${BUTTON_OUTLINE_CLASS} h-11 flex-1`}>
                  Bỏ qua
                </button>
                <button type="button" onClick={handleSaveAndClose} className={`${BUTTON_PRIMARY_CLASS} h-11 flex-[2]`}>
                  <Save size={16} aria-hidden="true" />
                  Lưu vào nhật ký
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
