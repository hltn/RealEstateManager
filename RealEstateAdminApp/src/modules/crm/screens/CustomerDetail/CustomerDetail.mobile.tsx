// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/CustomerDetailView.tsx, phong cách Admin App (tài liệu 03).
// Quy ước: không nhận props - đọc/ghi dữ liệu qua hook trong `@crm/store`, liên hệ khách qua `useContactActions`.
// Khung mobile (< 768px) là của Admin: `AppHeader` + drawer `AppSidebar`, vùng nội dung đã có `p-4`.
// Màn chi tiết là sub view -> CrmLayout KHÔNG hiện `CrmBottomNav`; màn tự vẽ thanh CTA đáy (MobileContactFooter)
// và chừa `pb-24` để nội dung cuối không bị thanh này che.
import { useState } from 'react';
import { CustomerNotFound } from '@crm/components/CustomerNotFound';
import { useCustomerCareLogs, useSelectedCustomer } from '@crm/store';
import { MobileCareLogSection } from './components/MobileCareLogSection';
import { MobileContactFooter } from './components/MobileContactFooter';
import { MobileCriteriaSection } from './components/MobileCriteriaSection';
import { MobileDetailHeader } from './components/MobileDetailHeader';
import { MobileDetailTabs, type MobileDetailTab } from './components/MobileDetailTabs';
import { MobileInvestmentSection } from './components/MobileInvestmentSection';
import { MobilePersonaSection } from './components/MobilePersonaSection';
import { MobileProfileCard } from './components/MobileProfileCard';

export const CustomerDetailMobile = () => {
  const customer = useSelectedCustomer();
  const careLogs = useCustomerCareLogs(customer?.id);
  const [activeTab, setActiveTab] = useState<MobileDetailTab>('info');

  if (!customer) {
    return <CustomerNotFound variant="mobile" title="Chi tiết khách hàng" />;
  }

  // Như bản Mobile: tab "Tiến độ" hiện cả chân dung + đầu tư + C4; tab "Nhật ký" chỉ hiện nhật ký.
  const isProfileVisible = activeTab !== 'timeline';
  const isCareLogVisible = activeTab !== 'progress';

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-24" data-testid="customer-detail-mobile">
      <MobileDetailHeader customerName={customer.name} />
      <MobileProfileCard customer={customer} />
      <MobileDetailTabs activeTab={activeTab} onChange={setActiveTab} />

      {isProfileVisible && (
        <>
          <MobilePersonaSection customer={customer} />
          <MobileInvestmentSection customer={customer} />
          <MobileCriteriaSection customer={customer} />
        </>
      )}

      {isCareLogVisible && <MobileCareLogSection key={customer.id} customer={customer} careLogs={careLogs} />}

      <MobileContactFooter customerId={customer.id} />
    </div>
  );
};

export default CustomerDetailMobile;
