// Thẻ "Chân dung khách hàng (C10)" của biến thể Mobile — phong cách Admin.
import { useState } from 'react';
import { Brain, Briefcase, Cake, Clock, Eye, EyeOff, IdCard } from 'lucide-react';
import { toHashtag } from '@crm/lib/customerAdapters';
import { useCrmActions } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { maskIdNumber } from '@crm/lib/contact';
import { orEmptyText } from '../customerDetailUtils';
import { InfoField } from './DetailParts';
import {
  BUTTON_LINK_CLASS,
  CAPTION_CLASS,
  CHIP_CLASS,
  CHIP_TONE_CLASS,
  DIVIDER_CLASS,
  INFO_VALUE_CLASS,
} from '@crm/lib/uiClasses';
import {
  MOBILE_CARD_CLASS,
  MOBILE_GROUP_BOX_CLASS,
  MobileEditButton,
  MobileGroupLabel,
  MobileSectionHeader,
} from './MobileSectionParts';

interface MobilePersonaSectionProps {
  customer: Customer;
}

export const MobilePersonaSection = ({ customer }: MobilePersonaSectionProps) => {
  const { navigate } = useCrmActions();
  const [isIdNumberVisible, setIsIdNumberVisible] = useState(false);
  const maskedIdNumber = maskIdNumber(customer.idNumber);
  const familyText = [customer.decisionMaker, customer.children].filter(Boolean).join('; ');
  const IdToggleIcon = isIdNumberVisible ? EyeOff : Eye;

  return (
    <section aria-label="Chân dung khách hàng" className={MOBILE_CARD_CLASS}>
      <MobileSectionHeader
        icon={Brain}
        title="Chân dung khách hàng (C10)"
        trailing={<MobileEditButton label="Sửa chân dung khách hàng" onClick={() => navigate('edit_persona')} />}
      />

      {/* Nhóm 1: Cá nhân & Dịp đặc biệt */}
      <div className={MOBILE_GROUP_BOX_CLASS}>
        <MobileGroupLabel icon={Cake}>Cá nhân &amp; Dịp đặc biệt</MobileGroupLabel>
        <div className="grid grid-cols-2 gap-3">
          <InfoField label="Sinh nhật">{orEmptyText(customer.birthDate)}</InfoField>
          <InfoField label="Quê quán">{orEmptyText(customer.hometown)}</InfoField>
          <InfoField label="Nơi ở hiện tại" className="col-span-2">
            {orEmptyText(customer.currentResidence)}
          </InfoField>
        </div>

        <div className={`flex items-center justify-between gap-2 border-t pt-3 ${DIVIDER_CLASS}`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <IdCard size={16} aria-hidden="true" />
            </span>
            <InfoField label="CCCD / Định danh" valueClassName={`${INFO_VALUE_CLASS} font-mono`}>
              {maskedIdNumber ? (
                <>
                  {isIdNumberVisible ? customer.idNumber : maskedIdNumber}
                  <span className="ml-1 font-sans text-theme-xs font-normal text-gray-400">
                    {isIdNumberVisible ? '(Đầy đủ)' : '(4 số cuối)'}
                  </span>
                </>
              ) : (
                'Chưa cập nhật'
              )}
            </InfoField>
          </div>
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

      {/* Nhóm 2: Nghề nghiệp & Gia đình */}
      <div className={MOBILE_GROUP_BOX_CLASS}>
        <MobileGroupLabel icon={Briefcase}>Nghề nghiệp &amp; Gia đình</MobileGroupLabel>
        <InfoField label="Nghề nghiệp">{orEmptyText(customer.occupation)}</InfoField>
        <InfoField label="Người quyết định & Gia cảnh">{orEmptyText(familyText)}</InfoField>
      </div>

      {/* Nhóm 3: Sở thích & Lối sống (C11) */}
      {customer.lifestyleTags.length > 0 && (
        <div className="space-y-2">
          <span className={`block ${CAPTION_CLASS}`}>Sở thích &amp; Lối sống (C11)</span>
          <div className="flex flex-wrap gap-1.5">
            {customer.lifestyleTags.map((tag) => (
              <span key={tag} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>
                {toHashtag(tag)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Nhóm 4: Khung giờ rảnh — thông báo trong trang tông warning */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-warning-100 bg-warning-50 p-3 text-theme-sm dark:border-warning-500/20 dark:bg-warning-500/10">
        <span className="flex shrink-0 items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <Clock size={16} aria-hidden="true" className="text-warning-500" />
          Khung giờ rảnh
        </span>
        <span className="text-right font-semibold text-gray-800 dark:text-white/90">{orEmptyText(customer.freeTimeSlot)}</span>
      </div>
    </section>
  );
};
