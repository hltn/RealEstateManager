// Tab "Thông tin & Chân dung" (Admin CustomerDetailView, tab 1): thẻ Chân dung (C10) + thẻ Thông tin đầu tư.
// Bố cục: 1 cột (<768) -> 2 cột (md..lg) -> 3 vùng ở xl (thêm cột tóm tắt `DesktopOverviewRail`).
// Lưới ô trong thẻ dùng container query (@container) để tự về 1 cột khi thẻ hẹp (cột xl 1280px).
import { useState, type ReactNode } from 'react';
import { Briefcase, Building2, Clock, Eye, EyeOff, IdCard, Info, Pencil, Users, type LucideIcon } from 'lucide-react';
import { toHashtag } from '@crm/lib/customerAdapters';
import { useCrmActions } from '@crm/store';
import type { CareLog, Customer } from '@crm/types/crm';
import { maskIdNumber } from '@crm/lib/contact';
import { orEmptyText } from '../customerDetailUtils';
import { CardHeading, InfoField } from './DetailParts';
import type { DesktopDetailTab } from './DesktopDetailTabs';
import { DesktopOverviewRail } from './DesktopOverviewRail';
import {
  BUTTON_LINK_CLASS,
  BUTTON_SOFT_SM_CLASS,
  CAPTION_CLASS,
  CARD_CLASS,
  CHIP_CLASS,
  CHIP_TONE_CLASS,
  DIVIDER_CLASS,
  INFO_LABEL_CLASS,
  INFO_VALUE_CLASS,
  INSET_CLASS,
} from '@crm/lib/uiClasses';

interface CustomerCardProps {
  customer: Customer;
}

interface DesktopInfoPanelProps extends CustomerCardProps {
  careLogs: CareLog[];
  onOpenTab: (tab: DesktopDetailTab) => void;
}

const PANEL_CARD_CLASS = `${CARD_CLASS} @container min-w-0 space-y-6 p-5 md:p-6`;

const EditButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-label={label} className={BUTTON_SOFT_SM_CLASS}>
    <Pencil size={14} aria-hidden="true" />
    Sửa
  </button>
);

const InfoTile = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => (
  <InfoField label={label} className={`${INSET_CLASS} p-3 ${className}`}>
    {children}
  </InfoField>
);

/** Ô có icon trước giá trị (Nghề nghiệp, Gia cảnh). */
const IconTile = ({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) => (
  <div className={`${INSET_CLASS} p-3`}>
    <span className={INFO_LABEL_CLASS}>{label}</span>
    <span className={`mt-1 flex items-start gap-2 ${INFO_VALUE_CLASS}`}>
      <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
      {children}
    </span>
  </div>
);

const PersonaCard = ({ customer }: CustomerCardProps) => {
  const { navigate } = useCrmActions();
  const [isIdNumberVisible, setIsIdNumberVisible] = useState(false);
  const maskedIdNumber = maskIdNumber(customer.idNumber);
  const familyText = [customer.decisionMaker, customer.children && `Có ${customer.children}`].filter(Boolean).join('; ');
  const IdToggleIcon = isIdNumberVisible ? EyeOff : Eye;

  return (
    <section className={PANEL_CARD_CLASS} aria-label="Chân dung khách hàng">
      <CardHeading
        icon={IdCard}
        title="Chân dung khách hàng (C10)"
        trailing={<EditButton label="Sửa chân dung khách hàng" onClick={() => navigate('edit_persona')} />}
      />

      <div className="space-y-3">
        <div className={CAPTION_CLASS}>Cá nhân &amp; Dịp đặc biệt</div>
        <div className="grid grid-cols-1 gap-3 @2xs:grid-cols-2">
          <InfoTile label="Ngày sinh">{orEmptyText(customer.birthDate)}</InfoTile>
          <InfoTile label="Quê quán">{orEmptyText(customer.hometown)}</InfoTile>
          <InfoTile label="Nơi ở hiện tại" className="@2xs:col-span-2">
            {orEmptyText(customer.currentResidence)}
          </InfoTile>
          <div className={`${INSET_CLASS} flex flex-wrap items-center justify-between gap-3 p-3 @2xs:col-span-2`}>
            <InfoField label="CCCD / Định danh" valueClassName={`${INFO_VALUE_CLASS} font-mono tracking-wider`}>
              {!maskedIdNumber ? 'Chưa cập nhật' : isIdNumberVisible ? customer.idNumber : `${maskedIdNumber} (4 số cuối)`}
            </InfoField>
            {maskedIdNumber && (
              <button
                type="button"
                onClick={() => setIsIdNumberVisible((isVisible) => !isVisible)}
                aria-pressed={isIdNumberVisible}
                className={BUTTON_LINK_CLASS}
              >
                <IdToggleIcon size={14} aria-hidden="true" />
                {isIdNumberVisible ? 'Ẩn' : 'Hiện'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className={CAPTION_CLASS}>Nghề nghiệp &amp; Gia cảnh</div>
        <div className="space-y-3">
          <IconTile icon={Briefcase} label="Nghề nghiệp / Vị trí">
            {orEmptyText(customer.occupation)}
          </IconTile>
          <IconTile icon={Users} label="Người quyết định & Gia cảnh">
            {orEmptyText(familyText)}
          </IconTile>
        </div>
      </div>

      <div className="space-y-3">
        <div className={CAPTION_CLASS}>Sở thích &amp; Lối sống (C11)</div>
        {customer.lifestyleTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {customer.lifestyleTags.map((tag) => (
              <span key={tag} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>
                {toHashtag(tag)}
              </span>
            ))}
          </div>
        )}
        {/* Thông báo trong trang tông warning (mẫu ExternalLogsScreen.tsx:194-199) */}
        <div className="flex items-center gap-3 rounded-lg border border-warning-100 bg-warning-50 p-3 text-theme-sm text-gray-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-gray-300">
          <Clock size={18} aria-hidden="true" className="shrink-0 text-warning-500" />
          <span>
            <strong className="font-semibold text-gray-800 dark:text-white/90">Khung giờ rảnh:</strong>{' '}
            {orEmptyText(customer.freeTimeSlot)}
          </span>
        </div>
      </div>
    </section>
  );
};

const InvestmentCard = ({ customer }: CustomerCardProps) => {
  const { navigate } = useCrmActions();
  const searchAreaText = [customer.searchArea, customer.specificLocation].filter(Boolean).join(' • ');

  return (
    <section className={PANEL_CARD_CLASS} aria-label="Thông tin đầu tư">
      <CardHeading
        icon={Building2}
        title="Thông tin đầu tư"
        trailing={<EditButton label="Sửa thông tin đầu tư" onClick={() => navigate('edit_investment')} />}
      />

      <div className="space-y-3">
        <div className={CAPTION_CLASS}>Dự án quan tâm</div>
        <div className="flex flex-wrap gap-2">
          {customer.interestedProjects.length === 0 && <span className={INFO_VALUE_CLASS}>Chưa cập nhật</span>}
          {customer.interestedProjects.map((project, index) => {
            const isPrimary = index === 0;
            return (
              <span key={project} className={`${CHIP_CLASS} ${isPrimary ? CHIP_TONE_CLASS.brand : CHIP_TONE_CLASS.gray}`}>
                {isPrimary && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
                {project}
              </span>
            );
          })}
        </div>
      </div>

      <div className={`${INSET_CLASS} space-y-3 p-4`}>
        <div className={CAPTION_CLASS}>Tài chính &amp; Ngân sách</div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={INFO_LABEL_CLASS}>Ngân sách dự kiến</span>
          <span className="text-lg font-semibold text-brand-500 dark:text-brand-400">
            {customer.budgetMin} – {customer.budgetMax} tỷ VNĐ
          </span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={INFO_LABEL_CLASS}>Vốn tự có sẵn</span>
          <span className={`${INFO_VALUE_CLASS} text-right`}>{orEmptyText(customer.equityRatio)}</span>
        </div>
        {customer.loanIncentive && (
          <div className={`flex items-start gap-2 border-t pt-3 text-theme-xs text-gray-600 dark:text-gray-400 ${DIVIDER_CLASS}`}>
            <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
            <span>Cần gói hỗ trợ lãi suất &amp; ân hạn nợ gốc từ ngân hàng đối tác.</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className={CAPTION_CLASS}>Nhu cầu &amp; Tiêu chí BĐS</div>
        <div className="grid grid-cols-1 gap-3 @2xs:grid-cols-2">
          <InfoTile label="Loại hình">{orEmptyText(customer.propertyType)}</InfoTile>
          <InfoTile label="Cơ cấu">{orEmptyText(customer.bedroomType)}</InfoTile>
        </div>

        {customer.purchasePurposes.length > 0 && (
          <div className="space-y-1.5">
            <span className={INFO_LABEL_CLASS}>Mục đích mua</span>
            <div className="flex flex-wrap gap-1.5">
              {customer.purchasePurposes.map((purpose) => (
                <span key={purpose} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.purple}`}>
                  {toHashtag(purpose)}
                </span>
              ))}
            </div>
          </div>
        )}

        {customer.criteriaPriorities.length > 0 && (
          <div className="space-y-1.5">
            <span className={INFO_LABEL_CLASS}>Tiêu chí ưu tiên</span>
            <div className="flex flex-wrap gap-1.5">
              {customer.criteriaPriorities.map((criterion) => (
                <span key={criterion} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                  {criterion}
                </span>
              ))}
            </div>
          </div>
        )}

        <InfoTile label="Khu vực & Địa bàn tìm kiếm">{searchAreaText || 'Chưa cập nhật'}</InfoTile>

        <div
          className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-theme-xs text-gray-500 dark:text-gray-400 ${DIVIDER_CLASS}`}
        >
          <span>
            Nguồn: <strong className="font-semibold text-gray-800 dark:text-white/90">{orEmptyText(customer.leadSource)}</strong>
          </span>
          <span>
            Mua/chốt:{' '}
            <strong className="font-semibold text-brand-500 dark:text-brand-400">{orEmptyText(customer.targetPurchaseTime)}</strong>
          </span>
        </div>
      </div>
    </section>
  );
};

export const DesktopInfoPanel = ({ customer, careLogs, onOpenTab }: DesktopInfoPanelProps) => (
  <div
    role="tabpanel"
    id="customer-detail-panel-info"
    aria-labelledby="customer-detail-tab-info"
    className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_17rem]"
  >
    <PersonaCard customer={customer} />
    <InvestmentCard customer={customer} />
    <DesktopOverviewRail customer={customer} careLogs={careLogs} onOpenTab={onOpenTab} />
  </div>
);
