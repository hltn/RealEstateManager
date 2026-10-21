// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/CustomerDetailView.tsx,
// phong cách Admin App (tài liệu 03): thẻ rounded-2xl viền, tab gạch chân, lucide-react, cặp `dark:` đầy đủ.
// Quy ước: không nhận props - đọc/ghi dữ liệu qua hook trong `@crm/store`, liên hệ khách qua `useContactActions`.
// Bố cục theo vùng nội dung Admin (`p-4 md:p-6`, max-w 1536): xếp chồng/2 cột ở md..lg, 3 vùng ở xl.
import { useState } from 'react';
import { CustomerNotFound } from '@crm/components/CustomerNotFound';
import { useCustomerCareLogs, useSelectedCustomer } from '@crm/store';
import { DesktopCareLogForm } from './components/DesktopCareLogForm';
import { DesktopCareTimeline } from './components/DesktopCareTimeline';
import { DesktopCriteriaPanel } from './components/DesktopCriteriaPanel';
import { DesktopDetailTabs, type DesktopDetailTab } from './components/DesktopDetailTabs';
import { DesktopHeaderCard } from './components/DesktopHeaderCard';
import { DesktopInfoPanel } from './components/DesktopInfoPanel';

export const CustomerDetailDesktop = () => {
  const customer = useSelectedCustomer();
  const careLogs = useCustomerCareLogs(customer?.id);
  const [activeTab, setActiveTab] = useState<DesktopDetailTab>('info');

  if (!customer) {
    return <CustomerNotFound variant="desktop" title="Chi tiết khách hàng" />;
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6" data-testid="customer-detail-desktop">
      <DesktopHeaderCard customer={customer} />

      <DesktopDetailTabs
        activeTab={activeTab}
        onChange={setActiveTab}
        progressPercentage={customer.progressPercentage}
        careLogCount={careLogs.length}
      />

      {activeTab === 'info' && <DesktopInfoPanel customer={customer} careLogs={careLogs} onOpenTab={setActiveTab} />}

      {activeTab === 'criteria' && <DesktopCriteriaPanel customer={customer} />}

      {activeTab === 'logs' && (
        <div
          role="tabpanel"
          id="customer-detail-panel-logs"
          aria-labelledby="customer-detail-tab-logs"
          className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12"
        >
          <DesktopCareLogForm key={customer.id} customer={customer} />
          <DesktopCareTimeline customerId={customer.id} careLogs={careLogs} />
        </div>
      )}
    </div>
  );
};

export default CustomerDetailDesktop;
