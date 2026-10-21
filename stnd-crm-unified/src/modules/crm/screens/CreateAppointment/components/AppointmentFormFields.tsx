/**
 * Nhóm trường của form Tạo lịch hẹn, dùng chung desktop + mobile (mỗi biến thể tự xếp vào khối/cột của mình).
 * Ô nhập/select/DatePicker/công tắc đều theo mẫu Admin; DatePicker = `components/ui/DatePicker` (flatpickr).
 */
import { BellRing, Building, Clock, Info, UserRound } from 'lucide-react';
import { PROJECTS } from '@crm/data/mockData';
import { DatePicker } from '../../../../../components/ui/DatePicker';
import {
  DETAILS_MAX_LENGTH,
  formatLongDateVi,
  getFieldId,
  REMINDER_OPTIONS,
  STAFF_OPTIONS,
} from '../createAppointmentForm';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { getDatePickerInputClass, getTextareaClass } from '@crm/lib/uiClasses';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { CustomerPicker } from './CustomerPicker';
import { LocationInput } from './LocationInput';
import { ProjectInfoLine } from './ProjectInfoLine';

interface FieldGroupProps {
  form: CreateAppointmentForm;
}

interface CustomerProjectFieldsProps extends FieldGroupProps {
  /** `picker` = thẻ khách + Dropdown (desktop), `select` = select gốc (mobile). */
  customerControl: 'picker' | 'select';
}

export const CustomerProjectFields = ({ form, customerControl }: CustomerProjectFieldsProps) => {
  const { values, errors, customers, selectedCustomer, setField, changeCustomer } = form;
  const customerId = getFieldId('customerId');
  const projectId = getFieldId('projectName');

  return (
    <div className="space-y-4">
      <FormField
        inputId={customerId}
        label="Khách hàng quan tâm"
        isRequired
        error={errors.customerId}
        hint={
          customerControl === 'select' && selectedCustomer ? `Phụ trách hiện tại: ${selectedCustomer.staffLead} • ${selectedCustomer.teamGroup}` : undefined
        }
      >
        {customerControl === 'picker' ? (
          <CustomerPicker
            id={customerId}
            customers={customers}
            selectedCustomer={selectedCustomer}
            hasError={Boolean(errors.customerId)}
            onChange={changeCustomer}
          />
        ) : (
          <SelectInput
            id={customerId}
            value={values.customerId}
            onChange={(event) => changeCustomer(event.target.value)}
            icon={UserRound}
            hasError={Boolean(errors.customerId)}
            emptyLabel="Chọn khách hàng"
            options={customers.map((customer) => ({
              value: customer.id,
              label: `${customer.name} — ${customer.phone} (${customer.status})`,
            }))}
            {...getFieldA11yProps(getErrorId(customerId), errors.customerId)}
          />
        )}
      </FormField>

      <FormField inputId={projectId} label="Dự án liên quan" isRequired error={errors.projectName} hint={<ProjectInfoLine projectName={values.projectName} />}>
        <SelectInput
          id={projectId}
          value={values.projectName}
          onChange={(event) => setField('projectName', event.target.value)}
          icon={Building}
          hasError={Boolean(errors.projectName)}
          emptyLabel="Chọn dự án"
          options={PROJECTS.map((project) => ({ value: project.name, label: `${project.fullName} (${project.location})` }))}
          {...getFieldA11yProps(getErrorId(projectId), errors.projectName)}
        />
      </FormField>
    </div>
  );
};

export const ScheduleFields = ({ form }: FieldGroupProps) => {
  const { values, errors, setField } = form;
  const dateId = getFieldId('date');
  const timeId = getFieldId('time');
  const locationId = getFieldId('location');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField inputId={dateId} label="Ngày diễn ra" isRequired error={errors.date} hint={formatLongDateVi(values.date)}>
          <DatePicker
            value={values.date}
            onChange={(date) => setField('date', date)}
            placeholder="Chọn ngày"
            inputClassName={getDatePickerInputClass(Boolean(errors.date))}
          />
        </FormField>
        <FormField inputId={timeId} label="Thời gian diễn ra" isRequired error={errors.time} hint="Giờ hẹn gặp trực tiếp với khách hàng">
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
      <FormField inputId={locationId} label="Địa điểm gặp mặt" isRequired error={errors.location} hint="Bấm biểu tượng định vị để dùng văn phòng bán hàng của dự án">
        <LocationInput
          id={locationId}
          value={values.location}
          projectName={values.projectName}
          error={errors.location}
          onChange={(location) => setField('location', location)}
        />
      </FormField>
    </div>
  );
};

export const DetailsField = ({ form }: FieldGroupProps) => {
  const { values, errors, setField } = form;
  const detailsId = getFieldId('details');
  const isOtherPurpose = values.type === 'khac';

  return (
    <FormField
      inputId={detailsId}
      label="Chi tiết trao đổi & nhiệm vụ chuẩn bị"
      isRequired={isOtherPurpose}
      error={errors.details}
      hint={
        <span className="flex items-center justify-between gap-2">
          <span>{isOtherPurpose ? 'Ghi rõ mục đích buổi hẹn' : 'Ghi chú nội bộ cho chuyên viên tư vấn và quản lý'}</span>
          <span className="shrink-0 font-medium tabular-nums">
            {values.details.length} / {DETAILS_MAX_LENGTH}
          </span>
        </span>
      }
    >
      <textarea
        id={detailsId}
        rows={4}
        value={values.details}
        maxLength={DETAILS_MAX_LENGTH}
        onChange={(event) => setField('details', event.target.value)}
        placeholder="VD: Khách quan tâm tầng cao view hồ. Chuẩn bị bảng tính dòng tiền, brochure và 02 bản thỏa thuận đặt cọc."
        className={getTextareaClass(Boolean(errors.details))}
        {...getFieldA11yProps(getErrorId(detailsId), errors.details)}
      />
    </FormField>
  );
};

export const StaffFields = ({ form }: FieldGroupProps) => {
  const { values, errors, setField } = form;
  const leadId = getFieldId('leadStaffId');
  const supportId = getFieldId('supportStaffId');

  return (
    <div className="space-y-4">
      <FormField inputId={leadId} label="Người phụ trách chính" isRequired error={errors.leadStaffId}>
        <SelectInput
          id={leadId}
          value={values.leadStaffId}
          onChange={(event) => setField('leadStaffId', event.target.value)}
          icon={UserRound}
          hasError={Boolean(errors.leadStaffId)}
          options={STAFF_OPTIONS.map((staff) => ({ value: staff.id, label: staff.name }))}
          {...getFieldA11yProps(getErrorId(leadId), errors.leadStaffId)}
        />
      </FormField>
      <FormField inputId={supportId} label="Cộng sự / quản lý hỗ trợ (tùy chọn)">
        <SelectInput
          id={supportId}
          value={values.supportStaffId}
          onChange={(event) => setField('supportStaffId', event.target.value)}
          icon={UserRound}
          emptyLabel="Không có người hỗ trợ"
          options={STAFF_OPTIONS.filter((staff) => staff.id !== values.leadStaffId).map((staff) => ({ value: staff.id, label: staff.name }))}
        />
      </FormField>
    </div>
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
  const reminderId = getFieldId('reminderBefore');

  return (
    <div className="space-y-3">
      <FormField inputId={reminderId} label="Thông báo nhắc trước">
        <SelectInput
          id={reminderId}
          value={values.reminderBefore}
          onChange={(event) => setField('reminderBefore', event.target.value)}
          icon={BellRing}
          options={REMINDER_OPTIONS}
        />
      </FormField>
      <ToggleRow
        title="Tự động gửi SMS / Zalo ZNS"
        description="Gửi thiệp mời xác nhận lịch đến khách"
        isChecked={values.smsZnsAuto}
        onChange={(isChecked) => setField('smsZnsAuto', isChecked)}
      />
      <ToggleRow
        title="Đồng bộ Google & Outlook"
        description="Tạo sự kiện trong Calendar chuyên viên"
        isChecked={values.calendarSync}
        onChange={(isChecked) => setField('calendarSync', isChecked)}
      />
    </div>
  );
};

/** Thông báo trong trang (mẫu Admin `ExternalLogsScreen.tsx:194-199`, tông brand) về luồng đồng bộ sau khi tạo. */
interface SyncNoticeProps {
  leadName: string;
}

export const SyncNotice = ({ leadName }: SyncNoticeProps) => (
  <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400">
    <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
    <p className="text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">
      Lịch hẹn sau khi tạo sẽ tự động đồng bộ vào mục <strong className="font-semibold">“Việc hôm nay”</strong> của {leadName || 'người phụ trách'} và
      gửi lời nhắc trên lịch di động của ban quản lý STND.
    </p>
  </div>
);
