/**
 * Nút "Thao tác khác" của thẻ lịch hẹn — dựng trên `components/ui/dropdown/Dropdown` của Admin
 * (nguồn Stitch chỉ có nút trang trí). Mục menu = `DropdownItem` của Admin (đã bổ sung cặp `dark:` + `type="button"`).
 */
import {
  CalendarClock,
  CalendarX2,
  CircleCheck,
  Ellipsis,
  EllipsisVertical,
  MessageSquareText,
  NotebookPen,
  Undo2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Dropdown } from '../../../../../components/ui/dropdown/Dropdown';
import { DropdownItem } from '../../../../../components/ui/dropdown/DropdownItem';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { useContactActions } from '@crm/hooks/useContactActions';
import { useCrmActions } from '@crm/store';
import { useAppointmentActions } from '../useAppointmentActions';
import type { AppointmentView as Appointment } from '@crm/api';
import { ICON_BUTTON_CLASS, SOLID_INPUT_CLASS } from '@crm/lib/uiClasses';
import { RescheduleAppointmentDialog } from './RescheduleAppointmentDialog';

interface AppointmentMoreMenuProps {
  appointment: Appointment;
  /** Biến thể icon: ngang (web) hoặc dọc (app) như 2 nguồn Stitch. */
  orientation?: 'horizontal' | 'vertical';
}

interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export const AppointmentMoreMenu = ({ appointment, orientation = 'horizontal' }: AppointmentMoreMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { selectCustomer } = useCrmActions();
  const { toggleCompleted, cancelAppointment } = useAppointmentActions();
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const { messageZalo, openQuickNote } = useContactActions();
  const TriggerIcon = orientation === 'vertical' ? EllipsisVertical : Ellipsis;
  const closeMenu = () => setIsOpen(false);

  const items: MenuItem[] = [
    { label: 'Xem hồ sơ khách', icon: UserRound, onSelect: () => selectCustomer(appointment.customer.id) },
    { label: 'Ghi chú nhanh', icon: NotebookPen, onSelect: () => openQuickNote(appointment.customer.id) },
    { label: 'Nhắn Zalo', icon: MessageSquareText, onSelect: () => messageZalo(appointment.customer.id) },
    {
      label: appointment.status === 'DONE' ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành',
      icon: appointment.status === 'DONE' ? Undo2 : CircleCheck,
      onSelect: () => toggleCompleted(appointment),
    },
    // Đổi giờ / hủy chỉ áp dụng cho lịch đang chờ thực hiện (backend từ chối sửa lịch đã xong/đã hủy).
    ...(appointment.status === 'SCHEDULED'
      ? [
          { label: 'Đổi giờ', icon: CalendarClock, onSelect: () => setIsRescheduling(true) },
          { label: 'Hủy lịch hẹn', icon: CalendarX2, onSelect: () => setIsConfirmingCancel(true) },
        ]
      : []),
  ];

  const closeCancelDialog = () => {
    setIsConfirmingCancel(false);
    setCancelReason('');
  };
  const confirmCancel = async () => {
    const isCanceled = await cancelAppointment(appointment, cancelReason);
    if (isCanceled) closeCancelDialog();
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Thao tác khác"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((isMenuOpen) => !isMenuOpen)}
        className={`dropdown-toggle ${ICON_BUTTON_CLASS}`}
      >
        <TriggerIcon size={18} aria-hidden="true" />
      </button>
      <Dropdown isOpen={isOpen} onClose={closeMenu} className="w-56 p-1.5">
        <ul aria-label="Thao tác lịch hẹn">
          {items.map(({ label, icon: Icon, onSelect }) => (
            <li key={label}>
              <DropdownItem
                className="rounded-lg"
                onItemClick={() => {
                  closeMenu();
                  onSelect();
                }}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={16} aria-hidden="true" className="shrink-0" />
                  {label}
                </span>
              </DropdownItem>
            </li>
          ))}
        </ul>
      </Dropdown>
      {isRescheduling && <RescheduleAppointmentDialog appointment={appointment} onClose={() => setIsRescheduling(false)} />}
      <ConfirmDialog
        isOpen={isConfirmingCancel}
        tone="danger"
        title="Hủy lịch hẹn này?"
        description="Lịch hẹn sẽ không còn hiện trên lịch và nhắc việc. Có thể bấm Hoàn tác ngay sau khi hủy."
        confirmLabel="Xác nhận hủy lịch"
        cancelLabel="Giữ lịch"
        onConfirm={() => void confirmCancel()}
        onCancel={closeCancelDialog}
      >
        <textarea
          aria-label="Lý do hủy (tùy chọn)"
          rows={2}
          maxLength={500}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder="Lý do hủy (tùy chọn)"
          className={`${SOLID_INPUT_CLASS} w-full`}
        />
      </ConfirmDialog>
    </div>
  );
};
