/**
 * Màn "Cấu hình STND AI" của CRM (khác `/ai-config` của Admin), dùng chung 2 biến thể:
 * - desktop/tablet: đầu trang Admin có nút Lưu, các thẻ cấu hình xếp dọc tối đa `max-w-4xl` như nguồn.
 * - mobile: không có nguồn Stitch -> cùng thẻ, nút Lưu/Khôi phục ở cuối nội dung (màn có CrmBottomNav nên không `fixed`).
 * Trình bày đồng bộ màn Admin `AiConfigScreen.tsx` (tiêu đề có icon Bot) / `CronjobScreen.tsx` (thẻ + công tắc).
 */
import { useId } from 'react';
import { Bot, ListChecks, RotateCcw, Save, Sparkles } from 'lucide-react';
import {
  BRAND_SOFT_CHIP_CLASS,
  BUTTON_OUTLINE_LG_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  CARD_CLASS,
} from '@crm/lib/uiClasses';
import { SectionCard } from '@crm/components/form/SectionCard';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { C4_STEP_PERCENT, useCrmAiConfigForm, type CrmAiToggleField } from './useCrmAiConfigForm';

const C4_CRITERIA = ['Nhu cầu', 'Động cơ', 'Tài chính', 'Thời gian chốt'] as const;

const AUTOMATION_ITEMS: { field: CrmAiToggleField; title: string; description: string }[] = [
  {
    field: 'isSmartSlotEnabled',
    title: 'Tự động đề xuất khung giờ rảnh tối ưu',
    description: 'Phân tích lịch sử cuộc gọi (ưu tiên 19:00 - 20:30 tối).',
  },
  {
    field: 'isDuplicateCheckEnabled',
    title: 'Đối soát trùng lặp số điện thoại',
    description: 'Ngăn 2 chuyên viên cùng chăm sóc một khách và bảo vệ hoa hồng.',
  },
  {
    field: 'isBirthdayReminderEnabled',
    title: 'Tự sinh việc nhắc sinh nhật',
    description: 'Tạo thẻ việc trước 3 ngày sinh nhật khách trong mục Việc hôm nay.',
  },
];

interface AutomationRowProps {
  title: string;
  description: string;
  isEnabled: boolean;
  onChange: (isEnabled: boolean) => void;
}

const AutomationRow = ({ title, description, isEnabled, onChange }: AutomationRowProps) => {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p id={titleId} className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {title}
        </p>
        <p id={descriptionId} className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
          {description}
        </p>
        <p className={`mt-1 text-xs font-medium uppercase tracking-wide ${isEnabled ? 'text-success-500' : 'text-gray-500 dark:text-gray-400'}`}>
          {isEnabled ? 'Đang bật' : 'Đã tắt'}
        </p>
      </div>
      <ToggleSwitch isChecked={isEnabled} onChange={onChange} labelledBy={titleId} describedBy={descriptionId} />
    </div>
  );
};

interface CrmAiConfigViewProps {
  variant: 'desktop' | 'mobile';
}

export const CrmAiConfigView = ({ variant }: CrmAiConfigViewProps) => {
  const { values, hasChanges, isDefault, setThreshold, setToggle, save, resetToDefault } = useCrmAiConfigForm();
  const isMobile = variant === 'mobile';
  const thresholdId = useId();
  const achievedCount = values.dealScoreThreshold / C4_STEP_PERCENT;

  const actions = (
    <>
      <button
        type="button"
        onClick={resetToDefault}
        disabled={isDefault}
        className={`${BUTTON_OUTLINE_LG_CLASS} disabled:cursor-not-allowed disabled:opacity-50 ${isMobile ? 'h-11 w-1/3' : ''}`}
      >
        <RotateCcw size={16} aria-hidden="true" />
        {isMobile ? 'Mặc định' : 'Khôi phục mặc định'}
      </button>
      <button type="button" onClick={save} disabled={!hasChanges} className={`${BUTTON_PRIMARY_LG_CLASS} ${isMobile ? 'h-11 flex-1' : ''}`}>
        <Save size={18} aria-hidden="true" />
        Lưu cấu hình
      </button>
    </>
  );

  return (
    <div className={`flex w-full max-w-4xl flex-col ${isMobile ? 'gap-4' : 'gap-6'}`}>
      <header
        className={`flex flex-col gap-2 border-b border-gray-200 dark:border-white/[0.05] ${
          isMobile ? 'pb-4' : 'pb-6 md:flex-row md:items-end md:justify-between md:gap-6'
        }`}
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <h2
              className={`flex items-center gap-2 font-semibold text-gray-800 md:gap-3 dark:text-white/90 ${
                isMobile ? 'text-xl' : 'text-title-sm'
              }`}
            >
              <Bot size={isMobile ? 24 : 32} aria-hidden="true" className="shrink-0 text-brand-500" />
              Cấu hình STND AI
            </h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BRAND_SOFT_CHIP_CLASS}`}>STND AI v2.6</span>
          </div>
          <p className="max-w-2xl text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Mô hình phân tích phễu khách hàng, gợi ý khung giờ gọi tối ưu và tự động hoá CRM.
          </p>
        </div>
        {!isMobile && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </header>

      <SectionCard
        icon={ListChecks}
        title="Chấm điểm 4 tiêu chí (C4)"
        description="Nhu cầu + Động cơ + Tài chính + Thời gian chốt, mỗi tiêu chí 25%"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <label htmlFor={thresholdId} className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Ngưỡng phân loại Khách net
            </label>
            <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
              Đạt ngưỡng này, hệ thống tự gán nhãn VIP và ưu tiên xếp lịch.
            </p>
          </div>
          <span className={`shrink-0 self-start rounded-lg px-3 py-1 text-base font-semibold ${BRAND_SOFT_CHIP_CLASS}`}>
            {values.dealScoreThreshold}% · {achievedCount}/4 đạt
          </span>
        </div>

        <div>
          <input
            id={thresholdId}
            type="range"
            min={C4_STEP_PERCENT}
            max={100}
            step={C4_STEP_PERCENT}
            value={values.dealScoreThreshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            aria-valuetext={`${values.dealScoreThreshold}%, cần ${achievedCount} trên 4 tiêu chí`}
            className="h-2 w-full cursor-pointer accent-brand-500"
          />
          {/* Thanh 4 đoạn: tiêu chí cần đạt theo ngưỡng (đoạn tô màu) */}
          <ol className="mt-3 grid grid-cols-4 gap-2" aria-label="Tiêu chí cần đạt">
            {C4_CRITERIA.map((criterion, index) => {
              const isRequired = index < achievedCount;
              return (
                <li key={criterion} className="min-w-0">
                  <span
                    aria-hidden="true"
                    className={`block h-1.5 rounded-full ${isRequired ? 'bg-brand-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                  />
                  <span
                    className={`mt-1.5 block truncate text-xs ${
                      isRequired ? 'font-medium text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {criterion}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </SectionCard>

      <SectionCard
        icon={Sparkles}
        title="Gợi ý bước tiếp theo & Tự động hoá"
        description="Học thói quen phản hồi tin nhắn, nghe máy của khách VIP"
      >
        <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {AUTOMATION_ITEMS.map((item) => (
            <AutomationRow
              key={item.field}
              title={item.title}
              description={item.description}
              isEnabled={values[item.field]}
              onChange={(isEnabled) => setToggle(item.field, isEnabled)}
            />
          ))}
        </div>
      </SectionCard>

      {isMobile && (
        <div className={`${CARD_CLASS} p-4`}>
          {hasChanges && (
            <p className="mb-3 text-theme-sm text-warning-600 dark:text-warning-500">Có thay đổi chưa lưu.</p>
          )}
          <div className="flex items-center gap-3">{actions}</div>
        </div>
      )}
    </div>
  );
};
