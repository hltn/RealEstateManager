// Khối "THÔNG TIN" (02 §4.3, C1): Khu vực (nơi ở), Nguồn khách, Dự án (chip), Thẻ, CCCD che, liên hệ, ngày tạo.
import { Info, Pencil } from 'lucide-react';
import type { CustomerDetail } from '@crm/api';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { BUTTON_SOFT_SM_CLASS, CARD_CLASS, CHIP_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { orEmptyText } from '../customerDetailUtils';
import { CardHeading, InfoField, NationalIdField, PhoneDisplay } from './DetailParts';

interface CustomerInfoCardProps {
  customer: CustomerDetail;
}

export const CustomerInfoCard = ({ customer }: CustomerInfoCardProps) => {
  const { navigate } = useCrmActions();
  return (
    <section aria-label="Thông tin khách hàng" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading
        icon={Info}
        title="Thông tin"
        trailing={
          <button type="button" onClick={() => navigate('edit_persona')} aria-label="Sửa thông tin khách hàng" className={BUTTON_SOFT_SM_CLASS}>
            <Pencil size={14} aria-hidden="true" />
            Sửa
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <InfoField label="Khu vực (nơi ở)">{orEmptyText(customer.area?.label)}</InfoField>
        <InfoField label="Nguồn khách">{orEmptyText(customer.source?.label)}</InfoField>
        <InfoField label="Dự án quan tâm" className="sm:col-span-2 xl:col-span-1">
          {customer.projects.length === 0 ? (
            'Chưa cập nhật'
          ) : (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {customer.projects.map((project) => (
                <span key={project.id} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>
                  {project.label}
                </span>
              ))}
            </span>
          )}
        </InfoField>
        <InfoField label="Thẻ sở thích / nghề nghiệp" className="sm:col-span-2 xl:col-span-1">
          {customer.tags.length === 0 ? (
            'Chưa gắn thẻ'
          ) : (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {customer.tags.map((tag) => (
                <span key={tag.id} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                  #{tag.label}
                </span>
              ))}
            </span>
          )}
        </InfoField>
        <InfoField label="CCCD">
          <NationalIdField customer={customer} />
        </InfoField>
        <InfoField label="Số điện thoại"><PhoneDisplay customer={customer} /></InfoField>
        <InfoField label="Email">{orEmptyText(customer.email)}</InfoField>
        <InfoField label="Tạo lúc">
          {formatVnDateTime(customer.createdAt)} · {customer.createdBy.displayName}
        </InfoField>
        {customer.notes.trim() && (
          <InfoField label="Ghi chú" className="sm:col-span-2 xl:col-span-1" valueClassName="whitespace-pre-line text-theme-sm text-gray-700 dark:text-gray-300">
            {customer.notes}
          </InfoField>
        )}
      </div>
    </section>
  );
};
