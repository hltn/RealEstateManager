/**
 * Ô "Ngày diễn ra" + "Giờ" và ô "Nhắc trước" của lịch hẹn, tách khỏi `useCreateAppointmentForm` để dùng chung:
 * form Tạo lịch hẹn (`AppointmentFormFields`) và form Nhật ký chăm sóc khi bật "Tạo lịch hẹn" (`CareLogForm`).
 * Chỉ trình bày: giá trị + lỗi + hàm đổi truyền vào qua props, id ô do nơi dùng đặt (hai form có thể cùng mở nên không được trùng id).
 */
import { BellRing, Clock } from 'lucide-react';
import { DatePicker } from '../../../../../components/ui/DatePicker';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { REMINDER_OPTIONS } from '@crm/lib/appointmentAdapters';
import { getDatePickerInputClass } from '@crm/lib/uiClasses';
import { formatLongDateVi } from '../createAppointmentForm';

interface ScheduleDateTimeFieldsProps {
  dateId: string;
  timeId: string;
  /** Khoá ngày VN "YYYY-MM-DD". */
  date: string;
  /** "HH:mm" giờ VN. */
  time: string;
  dateError?: string;
  timeError?: string;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  /** Lớp của lưới 2 ô (mặc định theo viewport; form trong khung hẹp truyền lớp container query). */
  gridClassName?: string;
}

export const ScheduleDateTimeFields = ({
  dateId,
  timeId,
  date,
  time,
  dateError,
  timeError,
  onDateChange,
  onTimeChange,
  gridClassName = 'grid grid-cols-1 gap-4 sm:grid-cols-2',
}: ScheduleDateTimeFieldsProps) => (
  <div className={gridClassName}>
    <FormField inputId={dateId} label="Ngày diễn ra" isRequired error={dateError} hint={formatLongDateVi(date)}>
      <DatePicker id={dateId} value={date} onChange={onDateChange} placeholder="Chọn ngày" inputClassName={getDatePickerInputClass(Boolean(dateError))} />
    </FormField>
    <FormField inputId={timeId} label="Giờ (giờ Việt Nam)" isRequired error={timeError}>
      <TextInput
        id={timeId}
        type="time"
        icon={Clock}
        value={time}
        onChange={(event) => onTimeChange(event.target.value)}
        hasError={Boolean(timeError)}
        className="dark:[color-scheme:dark]"
        {...getFieldA11yProps(getErrorId(timeId), timeError)}
      />
    </FormField>
  </div>
);

interface ReminderSelectFieldProps {
  id: string;
  /** Số phút nhắc trước, một trong `REMINDER_OPTIONS`. */
  value: number;
  onChange: (minutes: number) => void;
}

export const ReminderSelectField = ({ id, value, onChange }: ReminderSelectFieldProps) => (
  <FormField inputId={id} label="Nhắc trước">
    <SelectInput
      id={id}
      value={String(value)}
      onChange={(event) => onChange(Number(event.target.value))}
      icon={BellRing}
      options={REMINDER_OPTIONS.map((option) => ({ value: String(option.minutes), label: option.label }))}
    />
  </FormField>
);
