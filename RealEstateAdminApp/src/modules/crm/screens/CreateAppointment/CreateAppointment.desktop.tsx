// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/CreateAppointmentView.tsx
// theo phong cách Admin App (tài liệu 03): đầu trang + breadcrumb, thẻ/ô nhập/select/DatePicker/Dropdown/công tắc Admin,
// icon lucide, cặp `dark:`. Thẻ chọn loại kiểu radio + thanh hành động dính đáy vẽ theo Stitch.
// Validate trường bắt buộc rồi gọi `addAppointment` (store tự điều hướng về Lịch hẹn + toast).
import { BellRing, CalendarCheck, type LucideIcon, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';
import { SectionCard } from '@crm/components/form/SectionCard';
import { buildCrmPath } from '@crm/routes';
import { CARD_CLASS, CHIP_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
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
import { useCreateAppointmentForm } from './useCreateAppointmentForm';

interface SideCardProps {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}

const SideCard = ({ title, icon: Icon, children }: SideCardProps) => (
  <section aria-label={title} className={`${CARD_CLASS} space-y-4 p-6`}>
    <h3 className="flex items-center justify-between gap-2 border-b border-gray-100 pb-3 text-lg font-semibold text-gray-800 dark:border-white/[0.05] dark:text-white/90">
      {title}
      <Icon size={20} aria-hidden="true" className="text-gray-400 dark:text-gray-500" />
    </h3>
    {children}
  </section>
);

export const CreateAppointmentDesktop = () => {
  const form = useCreateAppointmentForm();
  const { values, setField, handleSubmit, cancel, pendingRequiredCount, isSubmitting } = form;
  const leadName = form.selectedCustomer?.careTeam.find((member) => member.user.id === values.assigneeId)?.user.displayName ?? '';

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-6">
      {/* 1. Breadcrumb + đầu trang */}
      <FormPageHeader
        variant="desktop"
        title="Tạo lịch hẹn mới"
        description="Thiết lập cuộc hẹn gặp gỡ khách hàng, dẫn xem nhà mẫu, ký cọc hoặc nhắc nhở chăm sóc định kỳ."
        breadcrumbs={[
          { label: 'Quản lý khách hàng', to: buildCrmPath('today') },
          { label: 'Lịch hẹn & Nhắc việc', to: buildCrmPath('appointments') },
          { label: 'Tạo lịch hẹn mới' },
        ]}
        badges={
          <span className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            Đang khởi tạo
          </span>
        }
        onBack={cancel}
      />

      {/* 2. Lưới 2 cột (≥1280) / 1 cột (768–1279) */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-8">
          <SectionCard step={1} title="Khách hàng">
            <CustomerFields form={form} customerControl="picker" />
          </SectionCard>

          <SectionCard step={2} title="Loại cuộc hẹn & Mục đích làm việc">
            <AppointmentTypePicker id={getFieldId('type')} value={values.type} onChange={(type) => setField('type', type)} variant="detailed" />
          </SectionCard>

          <SectionCard step={3} title="Thời gian & Địa điểm">
            <ScheduleFields form={form} />
          </SectionCard>

          <SectionCard step={4} title="Ghi chú & chuẩn bị">
            <NoteField form={form} />
          </SectionCard>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <SideCard title="Người thực hiện" icon={UsersRound}>
            <AssigneeField form={form} />
          </SideCard>

          <SideCard title="Nhắc nhở & Tự động" icon={BellRing}>
            <ReminderFields form={form} />
          </SideCard>

          <div className="md:col-span-2 xl:col-span-1">
            <SyncNotice assigneeName={leadName} />
          </div>
        </div>
      </div>

      {/* 3. Thanh hành động dính đáy (Stitch) */}
      <FormActionBar
        variant="desktop"
        submitLabel="Xác nhận tạo lịch hẹn"
        submitIcon={CalendarCheck}
        isSubmitting={isSubmitting}
        onCancel={cancel}
        info={pendingRequiredCount > 0 ? `Còn ${pendingRequiredCount} trường bắt buộc cần kiểm tra` : 'Đã đủ thông tin bắt buộc'}
      />
    </form>
  );
};

export default CreateAppointmentDesktop;
