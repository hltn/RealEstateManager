// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/CreateAppointmentView.tsx
// theo phong cách Admin App (tài liệu 03): đầu trang + breadcrumb, thẻ/ô nhập/select/DatePicker/Dropdown/công tắc Admin,
// icon lucide, cặp `dark:`. Thẻ chọn loại kiểu radio + thanh hành động dính đáy vẽ theo Stitch.
// Validate trường bắt buộc rồi gọi `addAppointment` (store tự điều hướng về Lịch hẹn + toast).
import { BellRing, CalendarCheck, type LucideIcon, Sparkles, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';
import { SectionCard } from '@crm/components/form/SectionCard';
import { buildCrmPath } from '@crm/routes';
import { useCrmActions } from '@crm/store';
import { CARD_CLASS, CHIP_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { STAFF_OPTIONS, getFieldId } from './createAppointmentForm';
import { AppointmentTypePicker } from './components/AppointmentTypePicker';
import {
  CustomerProjectFields,
  DetailsField,
  ReminderFields,
  ScheduleFields,
  StaffFields,
  SyncNotice,
} from './components/AppointmentFormFields';
import { useCreateAppointmentForm } from './useCreateAppointmentForm';

/** Gợi ý chuẩn bị nhanh (nguồn Admin Stitch) — bấm để chèn vào nội dung trao đổi. */
const QUICK_PREP_TIPS = ['Kiểm tra căn còn trống', 'In phiếu tính dòng tiền', 'Đăng ký xe đón khách'] as const;

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
  const { showToast } = useCrmActions();
  const { values, setField, handleSubmit, cancel, pendingRequiredCount } = form;
  const leadStaff = STAFF_OPTIONS.find((staff) => staff.id === values.leadStaffId);
  const leadName = leadStaff?.name ?? '';

  const addPrepTip = (tip: string) => {
    const nextDetails = values.details.trim() ? `${values.details.trim()}\n- ${tip}` : `- ${tip}`;
    setField('details', nextDetails);
    showToast({ title: `Đã thêm "${tip}" vào nội dung chuẩn bị`, type: 'info' });
  };

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
          <SectionCard step={1} title="Khách hàng & Dự án liên quan">
            <CustomerProjectFields form={form} customerControl="picker" />
          </SectionCard>

          <SectionCard step={2} title="Loại cuộc hẹn & Mục đích làm việc">
            <AppointmentTypePicker id={getFieldId('type')} value={values.type} onChange={(type) => setField('type', type)} variant="detailed" />
          </SectionCard>

          <SectionCard step={3} title="Thời gian & Địa điểm">
            <ScheduleFields form={form} />
          </SectionCard>

          <SectionCard step={4} title="Nội dung trao đổi & Chuẩn bị tài liệu">
            <DetailsField form={form} />
          </SectionCard>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <SideCard title="Nhân sự phụ trách" icon={UsersRound}>
            <StaffFields form={form} />
          </SideCard>

          <SideCard title="Nhắc nhở & Tự động" icon={BellRing}>
            <ReminderFields form={form} />
          </SideCard>

          <section aria-label="STND Smart Assistant" className={`${CARD_CLASS} space-y-4 p-6 md:col-span-2 xl:col-span-1`}>
            <h3 className="flex items-center gap-2 border-b border-gray-100 pb-3 text-lg font-semibold text-gray-800 dark:border-white/[0.05] dark:text-white/90">
              <Sparkles size={20} aria-hidden="true" className="text-brand-500 dark:text-brand-400" />
              STND Smart Assistant
            </h3>
            <SyncNotice leadName={leadName} />
            <div>
              <p className="mb-2 text-theme-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Gợi ý chuẩn bị nhanh</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PREP_TIPS.map((tip) => (
                  <button
                    key={tip}
                    type="button"
                    onClick={() => addPrepTip(tip)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    + {tip}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 3. Thanh hành động dính đáy (Stitch) */}
      <FormActionBar
        variant="desktop"
        submitLabel="Xác nhận tạo lịch hẹn"
        submitIcon={CalendarCheck}
        onCancel={cancel}
        info={pendingRequiredCount > 0 ? `Còn ${pendingRequiredCount} trường bắt buộc cần kiểm tra` : 'Đã đủ thông tin bắt buộc'}
      />
    </form>
  );
};

export default CreateAppointmentDesktop;
