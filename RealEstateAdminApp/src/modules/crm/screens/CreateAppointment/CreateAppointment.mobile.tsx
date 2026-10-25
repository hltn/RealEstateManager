// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/CreateAppointmentView.tsx theo phong cách Admin App.
// Mobile: KHÔNG vẽ top app bar (header/drawer là của Admin) -> hàng "← Quay lại" + tiêu đề trong nội dung;
// màn form không có CrmBottomNav nên tự vẽ thanh hành động dính đáy (sticky, không fixed để khỏi đè drawer Admin).
import { CalendarCheck } from 'lucide-react';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';
import { CHIP_SMALL_CLASS } from '@crm/lib/uiClasses';
import { getFieldId } from './createAppointmentForm';
import { AppointmentTypePicker } from './components/AppointmentTypePicker';
import {
  AssigneeField,
  CustomerFields,
  NoteField,
  ReminderFields,
  ScheduleFields,
  SyncNotice,
} from './components/AppointmentFormFields';
import { SectionCard } from '@crm/components/form/SectionCard';
import { useCreateAppointmentForm } from './useCreateAppointmentForm';

export const CreateAppointmentMobile = () => {
  const form = useCreateAppointmentForm();
  const { values, setField, handleSubmit, cancel, pendingRequiredCount, isSubmitting } = form;
  const leadName = form.selectedCustomer?.careTeam.find((member) => member.user.id === values.assigneeId)?.user.displayName ?? '';

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
      <FormPageHeader variant="mobile" title="Tạo lịch hẹn mới" onBack={cancel} />

      {/* Trạng thái khởi tạo */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3.5 dark:border-white/[0.05] dark:bg-white/[0.03]">
        <span className="flex items-center gap-2.5 text-theme-sm text-gray-700 dark:text-gray-300">
          <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-500" />
          Trạng thái: <span className="font-medium text-brand-600 dark:text-brand-400">Đang khởi tạo</span>
        </span>
        <span className="text-theme-xs text-gray-400 dark:text-gray-500">* bắt buộc</span>
      </div>

      <SectionCard step={1} title="Khách hàng">
        <CustomerFields form={form} customerControl="select" />
      </SectionCard>

      <SectionCard
        step={2}
        title="Loại cuộc hẹn"
        aside={<span className="text-theme-xs text-gray-400 dark:text-gray-500">Chọn 1 hình thức</span>}
      >
        <AppointmentTypePicker id={getFieldId('type')} value={values.type} onChange={(type) => setField('type', type)} variant="compact" />
      </SectionCard>

      <SectionCard
        step={3}
        title="Thời gian & Địa điểm"
      >
        <ScheduleFields form={form} />
      </SectionCard>

      <SectionCard step={4} title="Người thực hiện">
        <AssigneeField form={form} />
      </SectionCard>

      <SectionCard
        step={5}
        title="Nhắc nhở & Chuẩn bị"
        aside={
          CRM_FEATURE_FLAGS.isAppointmentNotifySyncEnabled && (values.smsZnsAuto || values.calendarSync) ? (
            <span className={`${CHIP_SMALL_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>Bật thông báo</span>
          ) : undefined
        }
      >
        <ReminderFields form={form} />
        <NoteField form={form} />
      </SectionCard>

      <SyncNotice assigneeName={leadName} />

      <FormActionBar
        variant="mobile"
        submitLabel="Xác nhận tạo lịch hẹn"
        submitIcon={CalendarCheck}
        isSubmitting={isSubmitting}
        onCancel={cancel}
        mobileNote={pendingRequiredCount > 0 ? `Còn ${pendingRequiredCount} trường bắt buộc cần kiểm tra` : undefined}
      />
    </form>
  );
};

export default CreateAppointmentMobile;
