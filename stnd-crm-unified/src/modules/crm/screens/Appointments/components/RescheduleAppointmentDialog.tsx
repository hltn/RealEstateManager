/**
 * Hộp "Đổi giờ" lịch hẹn: chọn ngày + giờ (giờ Việt Nam) mới, kiểm không ở quá khứ rồi `PATCH /crm/appointments/:id`.
 * Chỉ mount khi đang mở (đóng = hủy), nên mỗi lần mở luôn bắt đầu từ giờ hiện tại của lịch.
 */
import { CalendarDays, Clock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Modal } from '../../../../../components/ui/modal';
import type { AppointmentView } from '@crm/api';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { TextInput } from '@crm/components/form/TextInput';
import { getAppointmentTitle } from '@crm/lib/appointmentAdapters';
import { getVnTodayKey, toVnDateKey, toVnTime } from '@crm/lib/dateTime';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';
import { validateScheduleDateTime } from '../../CreateAppointment/createAppointmentForm';
import { useAppointmentActions } from '../useAppointmentActions';

const DATE_INPUT_ID = 'reschedule-date';
const TIME_INPUT_ID = 'reschedule-time';

interface RescheduleAppointmentDialogProps {
  appointment: AppointmentView;
  onClose: () => void;
}

export const RescheduleAppointmentDialog = ({ appointment, onClose }: RescheduleAppointmentDialogProps) => {
  const { rescheduleAppointment } = useAppointmentActions();
  const [date, setDate] = useState(() => toVnDateKey(appointment.startAt));
  const [time, setTime] = useState(() => toVnTime(appointment.startAt));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const errors = validateScheduleDateTime(date, time);
  const shownErrors = hasSubmitted ? errors : {};

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setHasSubmitted(true);
    if (errors.date || errors.time || isSubmitting) return;
    setIsSubmitting(true);
    const isSaved = await rescheduleAppointment(appointment, date, time);
    setIsSubmitting(false);
    if (isSaved) onClose();
  };

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-md">
      <form role="dialog" aria-modal="true" aria-labelledby="reschedule-title" onSubmit={handleSubmit} noValidate className="space-y-4 p-6">
        <div>
          <h3 id="reschedule-title" className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Đổi giờ lịch hẹn
          </h3>
          <p className="mt-1 truncate text-theme-sm text-gray-500 dark:text-gray-400">
            {appointment.customer.fullName} — {getAppointmentTitle(appointment)}
          </p>
        </div>
        <FormField inputId={DATE_INPUT_ID} label="Ngày mới" isRequired error={shownErrors.date}>
          <TextInput
            id={DATE_INPUT_ID}
            type="date"
            icon={CalendarDays}
            value={date}
            min={getVnTodayKey()}
            onChange={(event) => setDate(event.target.value)}
            hasError={Boolean(shownErrors.date)}
            className="dark:[color-scheme:dark]"
            {...getFieldA11yProps(getErrorId(DATE_INPUT_ID), shownErrors.date)}
          />
        </FormField>
        <FormField inputId={TIME_INPUT_ID} label="Giờ mới (giờ Việt Nam)" isRequired error={shownErrors.time}>
          <TextInput
            id={TIME_INPUT_ID}
            type="time"
            icon={Clock}
            value={time}
            onChange={(event) => setTime(event.target.value)}
            hasError={Boolean(shownErrors.time)}
            className="dark:[color-scheme:dark]"
            {...getFieldA11yProps(getErrorId(TIME_INPUT_ID), shownErrors.time)}
          />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={BUTTON_OUTLINE_CLASS}>
            Đóng
          </button>
          <button type="submit" disabled={isSubmitting} className={BUTTON_PRIMARY_CLASS}>
            {isSubmitting ? 'Đang lưu…' : 'Lưu giờ mới'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
