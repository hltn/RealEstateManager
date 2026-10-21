/**
 * Thẻ lịch hẹn trên app - bố cục thẻ của Mobile Stitch AppointmentsView, vỏ/chip/nút theo mẫu Admin + cặp `dark:`.
 * Khác nguồn: màu/nút theo LOẠI lịch (nguồn chia theo buổi sáng/chiều) để mọi loại hiển thị đúng ở cả 2 buổi;
 * nút "⋮" mở menu thao tác (Dropdown Admin) thay cho nút trang trí.
 */
import { AlarmClock, CircleCheck, Eye, IdCard, MapPin, NotebookPen, PhoneCall, Undo2, UserRound } from 'lucide-react';
import { useContactActions } from '@crm/hooks/useContactActions';
import { APPOINTMENT_TYPE_LABELS, getAppointmentTitle } from '@crm/lib/appointmentAdapters';
import { useCrmActions } from '@crm/store';
import type { Appointment } from '@crm/types/crm';
import { APPOINTMENT_TYPE_STYLES, getAppointmentActionVariant } from '../appointmentTypeStyles';
import { getCustomerStatusToneClass } from '@crm/components/CustomerStatusChip';
import { CARD_CLASS, CHIP_SMALL_CLASS } from '@crm/lib/uiClasses';
import { AppointmentMoreMenu } from './AppointmentMoreMenu';

interface AppointmentCardMobileProps {
  appointment: Appointment;
}

const ACTION_BASE_CLASS = 'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors';
const ACTION_PRIMARY_CLASS = `${ACTION_BASE_CLASS} bg-brand-500 text-white hover:bg-brand-600`;
const ACTION_SOFT_CLASS = `${ACTION_BASE_CLASS} bg-brand-50 text-brand-500 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:hover:bg-brand-500/25`;
const ACTION_SUCCESS_CLASS = `${ACTION_BASE_CLASS} bg-success-50 text-success-600 hover:bg-success-100 dark:bg-success-500/10 dark:text-success-500 dark:hover:bg-success-500/20`;
const ACTION_GRAY_CLASS = `${ACTION_BASE_CLASS} bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700`;
const ICON_OUTLINE_CLASS =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5';

export const AppointmentCardMobile = ({ appointment }: AppointmentCardMobileProps) => {
  const { selectCustomer, toggleAppointmentCompleted, showToast } = useCrmActions();
  const { callCustomer } = useContactActions();
  const style = APPOINTMENT_TYPE_STYLES[appointment.type];
  const TypeIcon = style.icon;
  const actionVariant = getAppointmentActionVariant(appointment.type);
  const { isCompleted } = appointment;
  const title = getAppointmentTitle(appointment);

  return (
    <article
      aria-label={title}
      className={`${CARD_CLASS} space-y-3 border-l-4 ${style.accentBorderClass} p-4 ${isCompleted ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`${CHIP_SMALL_CLASS} ${style.chipClass}`}>
              <TypeIcon size={12} aria-hidden="true" />
              {APPOINTMENT_TYPE_LABELS[appointment.type]}
            </span>
            {isCompleted && (
              <span className={`${CHIP_SMALL_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
                <CircleCheck size={12} aria-hidden="true" />
                Đã hoàn thành
              </span>
            )}
          </div>
          <h4 className={`mt-1.5 text-base font-semibold text-gray-800 dark:text-white/90 ${isCompleted ? 'line-through' : ''}`}>{title}</h4>
        </div>
        <AppointmentMoreMenu appointment={appointment} orientation="vertical" />
      </div>

      <div className="space-y-2 border-y border-gray-100 py-2.5 text-theme-sm text-gray-600 dark:border-white/[0.05] dark:text-gray-400">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <UserRound size={16} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
            <span className="truncate font-medium text-gray-800 dark:text-white/90">{appointment.customerName}</span>
          </div>
          <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${getCustomerStatusToneClass(appointment.customerTag)}`}>
            {appointment.customerTag}
          </span>
        </div>

        {actionVariant !== 'reminder' && (
          <div className="flex min-w-0 items-center gap-2">
            <MapPin size={16} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
            <span className="truncate" title={appointment.location}>
              {appointment.location}
            </span>
          </div>
        )}

        {actionVariant === 'visit' && (
          <div className="flex min-w-0 items-center gap-2">
            <IdCard size={16} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
            <span className="truncate">
              Phụ trách: <strong className="font-medium text-gray-800 dark:text-white/90">{appointment.leadStaffName}</strong>
            </span>
          </div>
        )}

        {actionVariant === 'deposit' && appointment.unitCode && (
          <p className="pl-6 text-theme-xs">
            <strong className="font-medium text-gray-800 dark:text-white/90">{appointment.unitCode}</strong>
            {appointment.unitPrice && <> • Giá: {appointment.unitPrice}</>}
          </p>
        )}

        {actionVariant === 'reminder' && appointment.details && (
          <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-2 dark:bg-white/[0.03]">
            <NotebookPen size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
            <span className="text-theme-xs italic text-gray-700 dark:text-gray-300">Ghi chú: &quot;{appointment.details}&quot;</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {actionVariant === 'visit' && (
          <>
            <button type="button" onClick={() => callCustomer(appointment.customerId)} className={ACTION_SOFT_CLASS}>
              <PhoneCall size={16} aria-hidden="true" />
              Gọi nhanh
            </button>
            <button type="button" onClick={() => selectCustomer(appointment.customerId)} className={ACTION_GRAY_CLASS}>
              <UserRound size={16} aria-hidden="true" />
              Vào hồ sơ khách
            </button>
          </>
        )}

        {actionVariant === 'deposit' && (
          <>
            <button
              type="button"
              aria-pressed={isCompleted}
              onClick={() => toggleAppointmentCompleted(appointment.id)}
              className={isCompleted ? ACTION_GRAY_CLASS : ACTION_SUCCESS_CLASS}
            >
              {isCompleted ? <Undo2 size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}
              {isCompleted ? 'Hoàn tác xác nhận' : 'Xác nhận hoàn thành'}
            </button>
            <button type="button" onClick={() => selectCustomer(appointment.customerId)} className={ACTION_SOFT_CLASS}>
              <Eye size={16} aria-hidden="true" />
              Xem chi tiết
            </button>
          </>
        )}

        {actionVariant === 'reminder' && (
          <>
            <button type="button" onClick={() => callCustomer(appointment.customerId)} className={ACTION_PRIMARY_CLASS}>
              <PhoneCall size={16} aria-hidden="true" />
              Gọi ngay cho khách
            </button>
            <button
              type="button"
              title="Hoãn lại"
              aria-label="Hoãn lại 30 phút"
              onClick={() => showToast({ title: 'Đã hoãn nhắc việc', message: 'Hệ thống sẽ nhắc lại sau 30 phút.', type: 'info' })}
              className={ICON_OUTLINE_CLASS}
            >
              <AlarmClock size={18} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </article>
  );
};
