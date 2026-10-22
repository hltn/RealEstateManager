/**
 * Nhóm trường của form Tạo lịch hẹn, dùng chung desktop + mobile (mỗi biến thể tự xếp vào khối/cột của mình).
 * Ô nhập/select/DatePicker/công tắc theo mẫu Admin; DatePicker = `components/ui/DatePicker` (flatpickr).
 */
import { BellRing, Clock, Info, Type, UserRound } from 'lucide-react';
import { useCatalogs } from '@crm/api';
import { DatePicker } from '../../../../../components/ui/DatePicker';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { REMINDER_OPTIONS } from '@crm/lib/appointmentAdapters';
import { getDatePickerInputClass, getTextareaClass } from '@crm/lib/uiClasses';
import { formatLongDateVi, getFieldId, getProjectOfficeLocation, NOTE_MAX_LENGTH } from '../createAppointmentForm';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { CustomerPicker } from './CustomerPicker';
import { LocationInput } from './LocationInput';

interface FieldGroupProps {
  form: CreateAppointmentForm;
}

interface CustomerFieldsProps extends FieldGroupProps {
  /** `picker` = thẻ khách + Dropdown (desktop), `select` = select gốc (mobile). */
  customerControl: 'picker' | 'select';
}

export const CustomerFields = ({ form, customerControl }: CustomerFieldsProps) => {
  const { values, errors, customers, customerTotal, setCustomerSearch, selectedCustomer, changeCustomer, setField } = form;
  const customerId = getFieldId('customerId');
  const titleId = getFieldId('title');

  return (
    <div className="space-y-4">
      <FormField
        inputId={customerId}
        label="Khách hàng"
        isRequired
        error={errors.customerId}
        hint={selectedCustomer?.primaryAssignee ? `Phụ trách chính: ${selectedCustomer.primaryAssignee.displayName}` : undefined}
      >
        {customerControl === 'picker' ? (
          <CustomerPicker id={customerId} customers={customers} total={customerTotal} onSearch={setCustomerSearch} selectedCustomer={selectedCustomer} hasError={Boolean(errors.customerId)} onChange={changeCustomer} />
        ) : (
          <SelectInput
            id={customerId}
            value={values.customerId}
            onChange={(event) => changeCustomer(event.target.value)}
            icon={UserRound}
            hasError={Boolean(errors.customerId)}
            emptyLabel="Chọn khách hàng"
            options={[
              // Khách đang chọn luôn có trong danh sách dù ngoài trang đầu.
              ...(selectedCustomer && !customers.some((customer) => customer.id === selectedCustomer.id) ? [selectedCustomer] : []),
              ...customers,
            ].map((customer) => ({ value: customer.id, label: `${customer.fullName} — ${customer.phoneMasked}` }))}
            {...getFieldA11yProps(getErrorId(customerId), errors.customerId)}
          />
        )}
      </FormField>
      <FormField inputId={titleId} label="Tiêu đề (tuỳ chọn)" hint="Bỏ trống = dùng tên loại lịch hẹn">
        <TextInput id={titleId} icon={Type} value={values.title} maxLength={120} onChange={(event) => setField('title', event.target.value)} placeholder="VD: Xem căn tầng 15" />
      </FormField>
    </div>
  );
};

export const ScheduleFields = ({ form }: FieldGroupProps) => {
  const { values, errors, setField, selectedCustomer } = form;
  const { catalogs } = useCatalogs();
  const dateId = getFieldId('date');
  const timeId = getFieldId('time');
  const locationId = getFieldId('location');
  const firstProject = catalogs.projects.find((project) => project.id === selectedCustomer?.projects[0]?.id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField inputId={dateId} label="Ngày diễn ra" isRequired error={errors.date} hint={formatLongDateVi(values.date)}>
          <DatePicker value={values.date} onChange={(date) => setField('date', date)} placeholder="Chọn ngày" inputClassName={getDatePickerInputClass(Boolean(errors.date))} />
        </FormField>
        <FormField inputId={timeId} label="Giờ (giờ Việt Nam)" isRequired error={errors.time}>
          <TextInput
            id={timeId}
            type="time"
            icon={Clock}
            value={values.time}
            onChange={(event) => setField('time', event.target.value)}
            hasError={Boolean(errors.time)}
            className="dark:[color-scheme:dark]"
            {...getFieldA11yProps(getErrorId(timeId), errors.time)}
          />
        </FormField>
      </div>
      <FormField inputId={locationId} label="Địa điểm" isRequired={values.type !== 'CALLBACK'} error={errors.location} hint="Bấm biểu tượng định vị để dùng văn phòng bán hàng của dự án khách quan tâm">
        <LocationInput id={locationId} value={values.location} officeLocation={getProjectOfficeLocation(firstProject)} error={errors.location} onChange={(location) => setField('location', location)} />
      </FormField>
    </div>
  );
};

export const NoteField = ({ form }: FieldGroupProps) => {
  const { values, errors, setField } = form;
  const noteId = getFieldId('note');
  const isOtherPurpose = values.type === 'OTHER';

  return (
    <FormField
      inputId={noteId}
      label="Ghi chú / chuẩn bị"
      isRequired={isOtherPurpose}
      error={errors.note}
      hint={
        <span className="flex items-center justify-between gap-2">
          <span>{isOtherPurpose ? 'Ghi rõ mục đích buổi hẹn' : 'Ghi chú nội bộ cho người thực hiện'}</span>
          <span className="shrink-0 font-medium tabular-nums">
            {values.note.length} / {NOTE_MAX_LENGTH}
          </span>
        </span>
      }
    >
      <textarea
        id={noteId}
        rows={4}
        value={values.note}
        maxLength={NOTE_MAX_LENGTH}
        onChange={(event) => setField('note', event.target.value)}
        placeholder="VD: Khách quan tâm tầng cao view hồ, cần chuẩn bị bảng tính dòng tiền."
        className={getTextareaClass(Boolean(errors.note))}
        {...getFieldA11yProps(getErrorId(noteId), errors.note)}
      />
    </FormField>
  );
};

/** Người thực hiện: chọn trong nhóm chăm sóc của khách (04 §3.5 `assigneeId`). */
export const AssigneeField = ({ form }: FieldGroupProps) => {
  const { values, errors, setField, selectedCustomer } = form;
  const assigneeId = getFieldId('assigneeId');
  const members = selectedCustomer?.careTeam ?? [];

  return (
    <FormField inputId={assigneeId} label="Người thực hiện" isRequired error={errors.assigneeId} hint={members.length === 0 ? 'Khách chưa có nhóm chăm sóc: lịch giao cho bạn.' : 'Chỉ chọn trong nhóm chăm sóc của khách.'}>
      <SelectInput
        id={assigneeId}
        value={values.assigneeId}
        onChange={(event) => setField('assigneeId', event.target.value)}
        icon={UserRound}
        disabled={members.length === 0}
        hasError={Boolean(errors.assigneeId)}
        options={
          members.length > 0
            ? members.map((member) => ({ value: member.user.id, label: `${member.user.fullName}${member.role === 'PRIMARY' ? ' (phụ trách chính)' : ''}` }))
            : [{ value: values.assigneeId, label: 'Tôi' }]
        }
        {...getFieldA11yProps(getErrorId(assigneeId), errors.assigneeId)}
      />
    </FormField>
  );
};

interface ToggleRowProps {
  title: string;
  description: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
}

const ToggleRow = ({ title, description, isChecked, onChange }: ToggleRowProps) => (
  <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-white/[0.05]">
    <div className="min-w-0">
      <p className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{description}</p>
    </div>
    <ToggleSwitch isChecked={isChecked} onChange={onChange} label={title} size="sm" />
  </div>
);

export const ReminderFields = ({ form }: FieldGroupProps) => {
  const { values, setField } = form;
  const reminderId = getFieldId('remindBeforeMinutes');

  return (
    <div className="space-y-3">
      <FormField inputId={reminderId} label="Nhắc trước">
        <SelectInput
          id={reminderId}
          value={String(values.remindBeforeMinutes)}
          onChange={(event) => setField('remindBeforeMinutes', Number(event.target.value))}
          icon={BellRing}
          options={REMINDER_OPTIONS.map((option) => ({ value: String(option.minutes), label: option.label }))}
        />
      </FormField>
      {/* Gửi SMS/ZNS + đồng bộ lịch: tính năng giai đoạn sau, ẩn sau cờ (mặc định tắt). */}
      {CRM_FEATURE_FLAGS.isAppointmentNotifySyncEnabled && (
        <>
          <ToggleRow title="Tự động gửi SMS / Zalo ZNS" description="Gửi tin xác nhận lịch đến khách" isChecked={values.smsZnsAuto} onChange={(isChecked) => setField('smsZnsAuto', isChecked)} />
          <ToggleRow title="Đồng bộ Google & Outlook" description="Tạo sự kiện trong lịch của người thực hiện" isChecked={values.calendarSync} onChange={(isChecked) => setField('calendarSync', isChecked)} />
        </>
      )}
    </div>
  );
};

/** Thông báo trong trang về nơi lịch hẹn sẽ xuất hiện sau khi tạo. */
export const SyncNotice = ({ assigneeName }: { assigneeName: string }) => (
  <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400">
    <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
    <p className="text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">
      Lịch hẹn sau khi tạo sẽ hiện trong mục <strong className="font-semibold">“Việc hôm nay”</strong> của {assigneeName || 'người thực hiện'} vào đúng ngày hẹn
      và cập nhật cột "Hẹn" của khách.
    </p>
  </div>
);
