/**
 * Widget "Gợi ý từ STND AI" (web) - nội dung theo Admin Stitch AppointmentsView.
 * Khác nguồn: vỏ thẻ Admin thay nền gradient tím; gợi ý suy từ các lịch chưa hoàn thành
 * của ngày đang chọn thay cho 2 gợi ý viết cứng.
 */
import { Calculator, ChartLine, FileText, Lightbulb, PhoneCall, Sparkles, type LucideIcon } from 'lucide-react';
import type { Appointment, AppointmentType } from '@crm/types/crm';
import { formatShortWeekdayDate } from '../appointmentSchedule';
import { CAPTION_CLASS, CARD_CLASS, CHIP_CLASS } from '@crm/lib/uiClasses';

const MAX_SUGGESTIONS = 2;

const SUGGESTION_BY_TYPE: Record<AppointmentType, { icon: LucideIcon; getTitle: (appointment: Appointment) => string }> = {
  ky_coc: { icon: Calculator, getTitle: () => 'Chuẩn bị bảng tính dòng tiền đợt 2' },
  xem_nha: { icon: FileText, getTitle: (appointment) => `Hồ sơ pháp lý ${appointment.projectName}` },
  gap_truc_tiep: { icon: ChartLine, getTitle: () => 'Chuẩn bị bảng so sánh lãi vay' },
  nhac_goi: { icon: PhoneCall, getTitle: () => 'Kịch bản gọi lại tư vấn' },
  khac: { icon: Lightbulb, getTitle: () => 'Chuẩn bị tài liệu buổi hẹn' },
};

interface AiSuggestionCardProps {
  appointments: Appointment[];
  selectedDate: string;
  todayIso: string;
}

export const AiSuggestionCard = ({ appointments, selectedDate, todayIso }: AiSuggestionCardProps) => {
  const suggestions = appointments.filter((appointment) => !appointment.isCompleted).slice(0, MAX_SUGGESTIONS);

  return (
    <div className={`${CARD_CLASS} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
            <Sparkles size={16} aria-hidden="true" />
          </span>
          <span className={CAPTION_CLASS}>Gợi ý từ STND AI</span>
        </div>
        <span className={`${CHIP_CLASS} bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400`}>
          {selectedDate === todayIso ? 'Hôm nay' : formatShortWeekdayDate(selectedDate)}
        </span>
      </div>

      <div className="space-y-2.5">
        {suggestions.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-200 p-3 text-theme-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Không có lịch cần chuẩn bị trong ngày này.
          </p>
        )}
        {suggestions.map((appointment) => {
          const { icon: Icon, getTitle } = SUGGESTION_BY_TYPE[appointment.type];
          return (
            <div
              key={appointment.id}
              className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]"
            >
              <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
              <div className="min-w-0">
                <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{getTitle(appointment)}</p>
                <p className="mt-0.5 line-clamp-3 text-theme-xs text-gray-500 dark:text-gray-400">
                  Khách <strong className="font-medium text-gray-700 dark:text-gray-300">{appointment.customerName}</strong> (
                  {appointment.projectName}) lúc {appointment.time}. {appointment.details}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
