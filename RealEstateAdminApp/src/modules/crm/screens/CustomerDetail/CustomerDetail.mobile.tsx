// Chi tiết khách trên điện thoại (02 §7): chia tab Thông tin / Nhật ký / Tiến độ; nút Gọi và Zalo cố định đáy.
// Màn chi tiết là sub view -> CrmLayout KHÔNG hiện `CrmBottomNav`; chừa `pb-24` cho thanh CTA đáy.
import { useState } from 'react';
import { useCareLogs, useCustomerDetail } from '@crm/api';
import { CustomerNotFound } from '@crm/components/CustomerNotFound';
import { TAB_ACTIVE_CLASS, TAB_BASE_CLASS, TAB_INACTIVE_CLASS } from '@crm/lib/uiClasses';
import { useCrmState } from '@crm/store';
import { CareLogForm } from './components/CareLogForm';
import { CareTeamCard } from './components/CareTeamCard';
import { CareTimeline } from './components/CareTimeline';
import { CriteriaBoard } from './components/CriteriaBoard';
import { CustomerHeader } from './components/CustomerHeader';
import { CustomerInfoCard } from './components/CustomerInfoCard';
import { NextStepNotice } from './components/DetailParts';
import { HistoryList } from './components/HistoryList';
import { MobileContactFooter } from './components/MobileContactFooter';
import { MobileDetailHeader } from './components/MobileDetailHeader';
import { PersonaCard, RealEstateNeedsCard } from './components/PersonaCards';

type MobileTab = 'info' | 'logs' | 'progress';

const TAB_ITEMS: { id: MobileTab; label: string }[] = [
  { id: 'info', label: 'Thông tin' },
  { id: 'logs', label: 'Nhật ký' },
  { id: 'progress', label: 'Tiến độ' },
];

export const CustomerDetailMobile = () => {
  const { selectedCustomerId } = useCrmState();
  const { data: customer } = useCustomerDetail(selectedCustomerId);
  const { data: careLogs } = useCareLogs(selectedCustomerId);
  const [activeTab, setActiveTab] = useState<MobileTab>('info');

  if (!customer) return <CustomerNotFound variant="mobile" title="Chi tiết khách hàng" />;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-24" data-testid="customer-detail-mobile">
      <MobileDetailHeader customerName={customer.fullName} />
      <CustomerHeader customer={customer} variant="mobile" />

      <div role="tablist" aria-label="Thông tin khách hàng" className="flex border-b border-gray-200 dark:border-white/[0.05]">
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`${TAB_BASE_CLASS} flex-1 px-2 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'info' && (
        <>
          <CustomerInfoCard customer={customer} />
          <PersonaCard customer={customer} />
          <RealEstateNeedsCard customer={customer} />
        </>
      )}

      {activeTab === 'logs' && (
        <>
          <CareLogForm key={customer.id} customer={customer} variant="mobile" />
          <CareTimeline careLogs={careLogs} />
          <HistoryList customerId={customer.id} />
        </>
      )}

      {activeTab === 'progress' && (
        <>
          <CriteriaBoard customer={customer} />
          <CareTeamCard customer={customer} />
          <NextStepNotice suggestions={customer.nextActionSuggestions} />
        </>
      )}

      <MobileContactFooter customerId={customer.id} isPhoneMasked={customer.isPhoneMasked} />
    </div>
  );
};

export default CustomerDetailMobile;
