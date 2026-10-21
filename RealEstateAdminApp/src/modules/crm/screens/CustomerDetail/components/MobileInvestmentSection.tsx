// Thẻ "Thông tin đầu tư" của biến thể Mobile (đọc qua adapter `toInvestmentInfo`) — phong cách Admin.
import { Building, CalendarCheck, House, Info, MapPin, TrendingUp, Wallet } from 'lucide-react';
import { toHashtag, toInvestmentInfo } from '@crm/lib/customerAdapters';
import { useCrmActions } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { orEmptyText } from '../customerDetailUtils';
import { InfoField } from './DetailParts';
import { CHIP_CLASS, CHIP_TONE_CLASS, INFO_LABEL_CLASS, INFO_VALUE_CLASS } from '@crm/lib/uiClasses';
import {
  MOBILE_CARD_CLASS,
  MOBILE_GROUP_BOX_CLASS,
  MobileEditButton,
  MobileGroupLabel,
  MobileSectionHeader,
} from './MobileSectionParts';

interface MobileInvestmentSectionProps {
  customer: Customer;
}

const SUMMARY_ROW_CLASS = 'flex items-start justify-between gap-3';

export const MobileInvestmentSection = ({ customer }: MobileInvestmentSectionProps) => {
  const { navigate } = useCrmActions();
  const info = toInvestmentInfo(customer);

  return (
    <section aria-label="Thông tin đầu tư" className={MOBILE_CARD_CLASS}>
      <MobileSectionHeader
        icon={TrendingUp}
        title="Thông tin đầu tư"
        trailing={<MobileEditButton label="Sửa thông tin đầu tư" onClick={() => navigate('edit_investment')} />}
      />

      {/* Nhóm 1: Dự án quan tâm */}
      <div className={MOBILE_GROUP_BOX_CLASS}>
        <MobileGroupLabel icon={Building}>Dự án quan tâm</MobileGroupLabel>
        <div className="flex flex-wrap gap-1.5">
          {info.projects.length === 0 && <span className={INFO_VALUE_CLASS}>Chưa cập nhật</span>}
          {info.projects.map((project) => (
            <span key={project} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>
              {project}
            </span>
          ))}
        </div>
      </div>

      {/* Nhóm 2: Tài chính & Ngân sách */}
      <div className={MOBILE_GROUP_BOX_CLASS}>
        <MobileGroupLabel icon={Wallet}>Tài chính &amp; Ngân sách</MobileGroupLabel>
        <div className="grid grid-cols-2 gap-3">
          <InfoField label="Ngân sách dự kiến" valueClassName="text-theme-sm font-semibold text-brand-500 dark:text-brand-400">
            {info.budgetMin} – {info.budgetMax}
          </InfoField>
          <InfoField label="Vốn tự có">{orEmptyText(info.ownCapitalRatio)}</InfoField>
        </div>
        {info.needsLoanSupport && (
          <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${CHIP_TONE_CLASS.brand}`}>
            <Info size={14} aria-hidden="true" className="shrink-0" />
            Cần gói hỗ trợ lãi suất &amp; ân hạn nợ gốc
          </span>
        )}
      </div>

      {/* Nhóm 3: Nhu cầu & Tiêu chí BĐS */}
      <div className={MOBILE_GROUP_BOX_CLASS}>
        <MobileGroupLabel icon={House}>Nhu cầu &amp; Tiêu chí BĐS</MobileGroupLabel>
        <div className="grid grid-cols-2 gap-3">
          <InfoField label="Loại hình BĐS">{orEmptyText(info.propertyType)}</InfoField>
          <InfoField label="Cơ cấu phòng">{orEmptyText(info.bedrooms)}</InfoField>
        </div>
        {info.purposes.length > 0 && (
          <div className="space-y-1.5">
            <span className={INFO_LABEL_CLASS}>Mục đích mua</span>
            <div className="flex flex-wrap gap-1.5">
              {info.purposes.map((purpose) => (
                <span key={purpose} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.purple}`}>
                  {toHashtag(purpose)}
                </span>
              ))}
            </div>
          </div>
        )}
        {info.priorityCriteria.length > 0 && (
          <div className="space-y-1.5">
            <span className={INFO_LABEL_CLASS}>Tiêu chí ưu tiên</span>
            <div className="flex flex-wrap gap-1.5">
              {info.priorityCriteria.map((criterion, index) => (
                <span key={criterion} className={`${CHIP_CLASS} ${index === 0 ? CHIP_TONE_CLASS.success : CHIP_TONE_CLASS.gray}`}>
                  {criterion}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Nhóm 4: Khu vực & Địa bàn tìm kiếm */}
      <div className={MOBILE_GROUP_BOX_CLASS}>
        <MobileGroupLabel icon={MapPin}>Khu vực &amp; Địa bàn tìm kiếm</MobileGroupLabel>
        <InfoField label="Khu vực tìm kiếm">{orEmptyText(info.searchArea)}</InfoField>
        <InfoField label="Vị trí cụ thể">{orEmptyText(info.specificLocation)}</InfoField>
      </div>

      {/* Nhóm 5: Nguồn khách & Kế hoạch — nhấn tông brand nhạt */}
      <div className="space-y-2 rounded-xl border border-brand-100 bg-brand-50 p-3 dark:border-brand-500/25 dark:bg-brand-500/10">
        <MobileGroupLabel icon={CalendarCheck}>Nguồn khách &amp; Kế hoạch</MobileGroupLabel>
        <div className={SUMMARY_ROW_CLASS}>
          <span className={`shrink-0 ${INFO_LABEL_CLASS}`}>Nguồn khách</span>
          <span className={`text-right ${INFO_VALUE_CLASS}`}>{orEmptyText(info.source)}</span>
        </div>
        <div className={SUMMARY_ROW_CLASS}>
          <span className={`shrink-0 ${INFO_LABEL_CLASS}`}>Dự kiến mua / chốt</span>
          <span className="text-right text-theme-sm font-semibold text-brand-500 dark:text-brand-400">{orEmptyText(info.targetTimeline)}</span>
        </div>
      </div>
    </section>
  );
};
