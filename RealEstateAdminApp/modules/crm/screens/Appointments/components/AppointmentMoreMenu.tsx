/**
 * Nút "Thao tác khác" của thẻ lịch hẹn — dựng trên `components/ui/dropdown/Dropdown` của Admin
 * (nguồn Stitch chỉ có nút trang trí). Mục menu = `DropdownItem` của Admin (đã bổ sung cặp `dark:` + `type="button"`).
 */
import {
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
import { useContactActions } from '@crm/hooks/useContactActions';
import { useCrmActions } from '@crm/store';
import type { Appointment } from '@crm/types/crm';
import { ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';

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
  const { selectCustomer, toggleAppointmentCompleted } = useCrmActions();
  const { messageZalo, openQuickNote } = useContactActions();
  const TriggerIcon = orientation === 'vertical' ? EllipsisVertical : Ellipsis;
  const closeMenu = () => setIsOpen(false);

  const items: MenuItem[] = [
    { label: 'Xem hồ sơ khách', icon: UserRound, onSelect: () => selectCustomer(appointment.customerId) },
    { label: 'Ghi chú nhanh', icon: NotebookPen, onSelect: () => openQuickNote(appointment.customerId) },
    { label: 'Nhắn Zalo', icon: MessageSquareText, onSelect: () => messageZalo(appointment.customerId) },
    {
      label: appointment.isCompleted ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành',
      icon: appointment.isCompleted ? Undo2 : CircleCheck,
      onSelect: () => toggleAppointmentCompleted(appointment.id),
    },
  ];

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
    </div>
  );
};
