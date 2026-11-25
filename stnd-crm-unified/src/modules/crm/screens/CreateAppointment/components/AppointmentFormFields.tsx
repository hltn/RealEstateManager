/**
 * Nhóm trường của form Tạo lịch hẹn, dùng chung desktop + mobile (mỗi biến thể tự xếp vào khối/cột của mình).
 * Ô nhập/select/DatePicker/công tắc theo mẫu Admin; DatePicker = `components/ui/DatePicker` (flatpickr).
 */
import { Info, Type, UserRound } from 'lucide-react';
import { useCatalogs } from '@crm/api';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { FieldError, getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { SearchableMultiSelect } from '@crm/components/form/SearchableMultiSelect';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleRow } from '@crm/components/form/ToggleRow';
import { MAX_APPOINTMENT_ASSIGNEES } from '@crm/lib/appointmentAssignees';
import { FORM_HINT_CLASS, getTextareaClass } from '@crm/lib/uiClasses';
import { getFieldId, getProjectOfficeLocation, NOTE_MAX_LENGTH } from '../createAppointmentForm';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { CustomerPicker } from './CustomerPicker';
import { LocationInput } from './LocationInput';
import { ProjectField } from './ProjectField';
import { ReminderSelectField, ScheduleDateTimeFields } from './ScheduleDateTimeFields';

interface FieldGroupProps {
  form: CreateAppointmentForm;
}

interface CustomerFieldsProps extends FieldGroupProps {
  /** `picker` = thẻ khách + Dropdown (desktop), `select` = select gốc (mobile). */
  customerControl: 'picker' | 'select';
}

export const CustomerFields = ({ form, customerControl }: CustomerFieldsProps) => {
  const { values, errors, customers, customerTotal, setCustomerSearch, selectedCustomer, isCustomerLoading, originCustomer, changeCustomer, setField } = form;
  // Mở từ chi tiết khách: khách bị khóa, người dùng đang đặt lịch cho đúng khách đó.
  const isCustomerLocked = originCustomer !== null;
  const hints = [isCustomerLocked ? 'Đặt lịch cho khách đang xem, không đổi được khách.' : '', selectedCustomer?.primaryAssignee ? `Phụ trách chính: ${selectedCustomer.primaryAssignee.displayName}` : ''].filter(Boolean);
  const customerId = getFieldId('customerId');
  const titleId = getFieldId('title');

  return (
    <div className="space-y-4">
      <FormField
        inputId={customerId}
        label="Khách hàng"
        isRequired
        isLabelStatic={isCustomerLocked}
        error={errors.customerId}
        hint={hints.length > 0 ? hints.join(' ') : undefined}
      >
        {/* Khóa: cả desktop lẫn mobile dùng thẻ khách chỉ-đọc (select disabled trông gần như select thường). */}
        {customerControl === 'picker' || isCustomerLocked ? (
          <CustomerPicker id={customerId} customers={customers} total={customerTotal} onSearch={setCustomerSearch} selectedCustomer={selectedCustomer} isLoading={isCustomerLoading} isLocked={isCustomerLocked} hasError={Boolean(errors.customerId)} onChange={changeCustomer} />
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
            ].map((customer) => ({ value: customer.id, label: [customer.fullName, [customer.customerCode, customer.phoneMasked].filter(Boolean).join(' · ')].filter(Boolean).join(' — ') }))}
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
  const { values, errors, setField } = form;
  const { catalogs } = useCatalogs();
  const dateId = getFieldId('date');
  const timeId = getFieldId('time');
  const locationId = getFieldId('location');
  // Văn phòng gợi ý theo dự án đã chọn cho lịch.
  const selectedProject = catalogs.projects.find((project) => project.id === values.projectId);

  return (
    <div className="space-y-4">
      <ScheduleDateTimeFields
        dateId={dateId}
        timeId={timeId}
        date={values.date}
        time={values.time}
        dateError={errors.date}
        timeError={errors.time}
        onDateChange={(date) => setField('date', date)}
        onTimeChange={(time) => setField('time', time)}
      />
      <ProjectField form={form} />
      <FormField inputId={locationId} label="Địa điểm" isRequired={values.type !== 'CALLBACK'} error={errors.location} hint="Bấm biểu tượng định vị để dùng văn phòng bán hàng của dự án đã chọn">
        <LocationInput id={locationId} value={values.location} officeLocation={getProjectOfficeLocation(selectedProject)} error={errors.location} onChange={(location) => setField('location', location)} />
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

/**
 * Người thực hiện (FR-30): CHỌN NHIỀU 1..20 người trong danh sách của khách (careTeam ∪ Manager nhóm chủ ∪ người tạo khách).
 * Danh sách do `listAssignableAssignees` dựng — cùng nguồn với mặc định và kiểm hợp lệ của form.
 */
export const AssigneeField = ({ form }: FieldGroupProps) => {
  const { values, errors, setField, assigneeOptions } = form;
  const assigneeId = getFieldId('assigneeIds');
  const toggleAssignee = (userId: string) =>
    setField('assigneeIds', values.assigneeIds.includes(userId) ? values.assigneeIds.filter((id) => id !== userId) : [...values.assigneeIds, userId]);

  return (
    <div className="min-w-0">
      <SearchableMultiSelect
        id={assigneeId}
        legend="Người thực hiện (chọn được nhiều)"
        isRequired
        icon={UserRound}
        listLabel="Danh sách người thực hiện"
        placeholder={assigneeOptions.length === 0 ? 'Chọn khách trước để có danh sách…' : 'Gõ để tìm người thực hiện…'}
        emptyMessage="Không có người phù hợp."
        options={assigneeOptions.map((option) => ({ value: option.userId, label: option.label }))}
        selected={values.assigneeIds}
        onToggle={toggleAssignee}
        disabled={assigneeOptions.length === 0}
        {...getFieldA11yProps(getErrorId(assigneeId), errors.assigneeIds)}
      />
      <FieldError id={getErrorId(assigneeId)} message={errors.assigneeIds} />
      {!errors.assigneeIds && (
        <p className={FORM_HINT_CLASS}>
          {assigneeOptions.length === 0
            ? 'Chưa có người nào chọn được cho khách này.'
            : `Chọn 1 đến ${MAX_APPOINTMENT_ASSIGNEES} người: nhóm chăm sóc, quản lý nhóm chủ hoặc người tạo khách.`}
        </p>
      )}
    </div>
  );
};

/** Đường kẻ ngăn trên của các hàng công tắc trong khối nhắc. */
const TOGGLE_ROW_CLASS = 'border-t border-gray-100 pt-3 dark:border-white/[0.05]';

export const ReminderFields = ({ form }: FieldGroupProps) => {
  const { values, setField } = form;
  const reminderId = getFieldId('remindBeforeMinutes');

  return (
    <div className="space-y-3">
      <ReminderSelectField id={reminderId} value={values.remindBeforeMinutes} onChange={(minutes) => setField('remindBeforeMinutes', minutes)} />
      {/* Gửi SMS/ZNS + đồng bộ lịch: tính năng giai đoạn sau, ẩn sau cờ (mặc định tắt). */}
      {CRM_FEATURE_FLAGS.isAppointmentNotifySyncEnabled && (
        <>
          <ToggleRow className={TOGGLE_ROW_CLASS} title="Tự động gửi SMS / Zalo ZNS" description="Gửi tin xác nhận lịch đến khách" isChecked={values.smsZnsAuto} onChange={(isChecked) => setField('smsZnsAuto', isChecked)} />
          <ToggleRow className={TOGGLE_ROW_CLASS} title="Đồng bộ Google & Outlook" description="Tạo sự kiện trong lịch của người thực hiện" isChecked={values.calendarSync} onChange={(isChecked) => setField('calendarSync', isChecked)} />
        </>
      )}
    </div>
  );
};

/** Thông báo trong trang về nơi lịch hẹn sẽ xuất hiện sau khi tạo. */
export const SyncNotice = ({ assigneeNames }: { assigneeNames: readonly string[] }) => (
  <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400">
    <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
    <p className="text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">
      Lịch hẹn sau khi tạo sẽ hiện trong mục <strong className="font-semibold">“Việc hôm nay”</strong> của {assigneeNames.length > 0 ? assigneeNames.join(', ') : 'người thực hiện'} vào đúng ngày hẹn
      và cập nhật cột "Hẹn" của khách.
    </p>
  </div>
);
