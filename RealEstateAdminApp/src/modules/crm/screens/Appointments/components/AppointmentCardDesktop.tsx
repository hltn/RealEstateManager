/**
 * Thẻ lịch hẹn trên web - bố cục các thẻ sự kiện của Admin Stitch AppointmentsView
 * (timeline theo buổi — Admin App không có), vỏ thẻ/chip/nút theo mẫu Admin + cặp `dark:`.
 */
import {
  Building,
  Building2,
  CircleCheck,
  Eye,
  IdCard,
  MapPin,
  NotebookPen,
  Phone,
  PhoneCall,
  StickyNote,
  Undo2,
  UserRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useContactActions } from '@crm/hooks/useContactActions';
import { APPOINTMENT_TYPE_LABELS, getAppointmentTitle } from '@crm/lib/appointmentAdapters';
import { useCrmActions } from '@crm/store';
import { useAppointmentActions } from '../useAppointmentActions';
import type { AppointmentView as Appointment } from '@crm/api';
import { APPOINTMENT_TYPE_STYLES, getAppointmentActionVariant } from '../appointmentTypeStyles';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { CARD_CLASS, CHIP_CLASS } from '@crm/lib/uiClasses';
import { AppointmentMoreMenu } from './AppointmentMoreMenu';

interface AppointmentCardDesktopProps {
  appointment: Appointment;
}

/** Nút nhỏ trong thẻ (mẫu "nút trong bảng" của Admin, cao 36px). */
const ACTION_BASE_CLASS =
  'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap';
const ACTION_PRIMARY_CLASS = `${ACTION_BASE_CLASS} bg-brand-500 text-white hover:bg-brand-600`;
const ACTION_SOFT_CLASS = `${ACTION_BASE_CLASS} bg-brand-50 text-brand-500 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:hover:bg-brand-500/25`;
const ACTION_SUCCESS_CLASS = `${ACTION_BASE_CLASS} bg-success-50 text-success-600 hover:bg-success-100 dark:bg-success-500/10 dark:text-success-500 dark:hover:bg-success-500/20`;
const OUTLINE_TONE_CLASS = 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5';
const ACTION_OUTLINE_CLASS = `${ACTION_BASE_CLASS} ${OUTLINE_TONE_CLASS}`;
const ACTION_ICON_OUTLINE_CLASS = `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${OUTLINE_TONE_CLASS}`;

interface InfoRowProps {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}

const InfoRow = ({ icon, children, className = '' }: InfoRowProps) => (
  <div className={`flex min-w-0 items-center gap-2 ${className}`}>
    <span aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500">
      {icon}
    </span>
    {children}
  </div>
);

export const AppointmentCardDesktop = ({ appointment }: AppointmentCardDesktopProps) => {
  const { selectCustomer } = useCrmActions();
  const { toggleCompleted } = useAppointmentActions();
  const { callCustomer, openQuickNote } = useContactActions();
  const style = APPOINTMENT_TYPE_STYLES[appointment.type];
  const TypeIcon = style.icon;
  const actionVariant = getAppointmentActionVariant(appointment.type);
  const isCompleted = appointment.status === 'DONE';
  const title = getAppointmentTitle(appointment);

  const openProfile = () => selectCustomer(appointment.customer.id);
  const handleToggleCompleted = () => toggleCompleted(appointment);

  return (
    <article
      aria-label={title}
      className={`${CARD_CLASS} border-l-4 ${style.accentBorderClass} p-5 transition-shadow hover:shadow-theme-sm ${isCompleted ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h4 className={`text-base font-semibold text-gray-800 dark:text-white/90 ${isCompleted ? 'line-through' : ''}`}>{title}</h4>
            <span className={`${CHIP_CLASS} ${style.chipClass}`}>
              <TypeIcon size={12} aria-hidden="true" />
              {APPOINTMENT_TYPE_LABELS[appointment.type]}
            </span>
            {isCompleted && (
              <span className={`${CHIP_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
                <CircleCheck size={12} aria-hidden="true" />
                Đã hoàn thành
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-2 pt-1 text-theme-sm text-gray-600 sm:grid-cols-2 dark:text-gray-400">
            <InfoRow icon={<UserRound size={16} />}>
              <span className="truncate font-medium text-gray-800 dark:text-white/90">{appointment.customer.fullName}</span>
              <CustomerStatusChip status={appointment.customer.status} size="small" />
            </InfoRow>
            {appointment.customer.phoneMasked && (
              <InfoRow icon={<Phone size={16} />}>
                <span className="truncate">
                  SĐT: <strong className="font-medium text-gray-800 dark:text-white/90">{appointment.customer.phoneMasked}</strong>
                </span>
              </InfoRow>
            )}

            {appointment.project && (
              <InfoRow icon={<Building2 size={16} />}>
                <span className="truncate" title={appointment.project.label}>
                  Dự án: <strong className="font-medium text-gray-800 dark:text-white/90">{appointment.project.label}</strong>
                </span>
              </InfoRow>
            )}

            {actionVariant === 'reminder' ? (
              appointment.note && (
                <div className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5 sm:col-span-2 dark:border-white/[0.05] dark:bg-white/[0.02]">
                  <StickyNote size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
                  <span className="text-theme-xs leading-relaxed text-gray-700 dark:text-gray-300">
                    <strong className="font-semibold">Ghi chú:</strong> {appointment.note}
                  </span>
                </div>
              )
            ) : (
              <>
                <InfoRow icon={actionVariant === 'deposit' ? <Building size={16} /> : <MapPin size={16} />}>
                  <span className="truncate" title={appointment.location}>
                    {actionVariant === 'deposit' ? `Địa điểm: ${appointment.location}` : appointment.location}
                  </span>
                </InfoRow>
                <InfoRow icon={<IdCard size={16} />}>
                  <span className="truncate">
                    Phụ trách: <strong className="font-medium text-brand-600 dark:text-brand-400">{appointment.assignee.displayName}</strong>
                  </span>
                </InfoRow>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-gray-100 pt-3 md:w-44 md:border-t-0 md:pt-0 dark:border-white/[0.05]">
          {actionVariant === 'visit' && (
            <>
              <button type="button" onClick={() => callCustomer(appointment.customer.id)} className={ACTION_SOFT_CLASS}>
                <PhoneCall size={14} aria-hidden="true" />
                Gọi nhanh
              </button>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={openProfile} className={ACTION_OUTLINE_CLASS}>
                  Hồ sơ khách
                </button>
                <AppointmentMoreMenu appointment={appointment} />
              </div>
            </>
          )}

          {actionVariant === 'deposit' && (
            <>
              <button type="button" aria-pressed={isCompleted} onClick={handleToggleCompleted} className={isCompleted ? ACTION_OUTLINE_CLASS : ACTION_SUCCESS_CLASS}>
                {isCompleted ? <Undo2 size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
                {isCompleted ? 'Hoàn tác xác nhận' : 'Xác nhận hoàn thành'}
              </button>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => openQuickNote(appointment.customer.id)} className={ACTION_OUTLINE_CLASS}>
                  <NotebookPen size={14} aria-hidden="true" />
                  Ghi chú cọc
                </button>
                <button type="button" title="Xem hồ sơ" aria-label="Xem hồ sơ" onClick={openProfile} className={ACTION_ICON_OUTLINE_CLASS}>
                  <Eye size={16} aria-hidden="true" />
                </button>
              </div>
            </>
          )}

          {actionVariant === 'reminder' && (
            <>
              <button type="button" onClick={() => callCustomer(appointment.customer.id)} className={ACTION_PRIMARY_CLASS}>
                <PhoneCall size={14} aria-hidden="true" />
                Gọi ngay cho khách
              </button>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-pressed={isCompleted} onClick={handleToggleCompleted} className={ACTION_OUTLINE_CLASS}>
                  {isCompleted ? 'Hoàn tác liên hệ' : 'Đã liên hệ xong'}
                </button>
                <button type="button" title="Xem hồ sơ" aria-label="Xem hồ sơ" onClick={openProfile} className={ACTION_ICON_OUTLINE_CLASS}>
                  <Eye size={16} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
};
