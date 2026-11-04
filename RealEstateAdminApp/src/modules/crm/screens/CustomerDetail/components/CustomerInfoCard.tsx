// Khối "THÔNG TIN" (02 §4.3, C1): Khu vực (nơi ở), Nguồn khách, Dự án (chip), Thẻ, CCCD che, Email, ngày tạo.
// PT-018: KHÔNG hiện SĐT ở đây (SĐT che + "Hiện số" + nút Gọi/Zalo vẫn ở `CustomerHeader`/`MobileContactFooter`, giữ C14 + log `PHONE_VIEWED`);
// trường chưa có dữ liệu thì ẩn ở chế độ xem (muốn nhập thì bấm "Sửa" — màn sửa luôn hiện đủ trường).
import { Info, Pencil } from 'lucide-react';
import type { CustomerDetail } from '@crm/api';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { BUTTON_SOFT_SM_CLASS, CARD_CLASS, CHIP_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { hasText } from '../customerDetailUtils';
import { CardHeading, InfoField, NationalIdField } from './DetailParts';

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
        {hasText(customer.area?.label) && <InfoField label="Khu vực (nơi ở)">{customer.area?.label}</InfoField>}
        {hasText(customer.source?.label) && <InfoField label="Nguồn khách">{customer.source?.label}</InfoField>}
        {customer.projects.length > 0 && (
          <InfoField label="Dự án quan tâm" className="sm:col-span-2 xl:col-span-1">
            <span className="mt-1 flex flex-wrap gap-1.5">
              {customer.projects.map((project) => (
                <span key={project.id} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>
                  {project.label}
                </span>
              ))}
            </span>
          </InfoField>
        )}
        {customer.tags.length > 0 && (
          <InfoField label="Thẻ sở thích / nghề nghiệp" className="sm:col-span-2 xl:col-span-1">
            <span className="mt-1 flex flex-wrap gap-1.5">
              {customer.tags.map((tag) => (
                <span key={tag.id} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                  #{tag.label}
                </span>
              ))}
            </span>
          </InfoField>
        )}
        {customer.hasNationalId && (
          <InfoField label="CCCD">
            <NationalIdField customer={customer} />
          </InfoField>
        )}
        {hasText(customer.email) && <InfoField label="Email">{customer.email}</InfoField>}
        <InfoField label="Tạo lúc">
          {formatVnDateTime(customer.createdAt)} · {customer.createdBy.displayName}
        </InfoField>
      </div>
    </section>
  );
};
