// Chi tiết khách — bố cục 3 vùng theo tài liệu 02 §4.3 (máy tính); máy tính bảng 2 vùng (02 §7):
// THÔNG TIN + CHÂN DUNG | NHẬT KÝ CHĂM SÓC (ô ghi chú nhanh ở đầu) / LỊCH SỬ THAY ĐỔI | TIẾN ĐỘ + NHÓM CHĂM SÓC + GỢI Ý.
// Dữ liệu qua lớp `@crm/api` (khách ngoài phạm vi quyền = không tìm thấy).
import { useState } from 'react';
import { useCareLogs, useCustomerDetail } from '@crm/api';
import { CustomerLoadState } from '@crm/components/CustomerLoadState';
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
import { PersonaCard, RealEstateNeedsCard } from './components/PersonaCards';
import { UpcomingAppointmentsSection } from './components/UpcomingAppointmentsSection';

type CenterTab = 'logs' | 'history';

const CENTER_TABS: { id: CenterTab; label: string }[] = [
  { id: 'logs', label: 'Nhật ký chăm sóc' },
  { id: 'history', label: 'Lịch sử thay đổi' },
];

export const CustomerDetailDesktop = () => {
  const { selectedCustomerId } = useCrmState();
  const { data: customer, isLoading, isNotFound, error, refetch } = useCustomerDetail(selectedCustomerId);
  const primaryUserId = customer?.careTeam.find((member) => member.role === 'PRIMARY')?.user.id ?? null;
  const careLogsState = useCareLogs(selectedCustomerId, primaryUserId);
  const careLogs = careLogsState.data;
  const [centerTab, setCenterTab] = useState<CenterTab>('logs');

  if (!customer) return <CustomerLoadState variant="desktop" title="Chi tiết khách hàng" isLoading={isLoading} isNotFound={isNotFound} error={error} onRetry={refetch} />;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6" data-testid="customer-detail-desktop">
      <CustomerHeader customer={customer} variant="desktop" />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_minmax(0,21rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CustomerInfoCard customer={customer} />
          <PersonaCard customer={customer} />
          <RealEstateNeedsCard customer={customer} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:row-span-2 xl:row-span-1">
          <div role="tablist" aria-label="Nhật ký và lịch sử" className="flex gap-1 border-b border-gray-200 dark:border-white/[0.05]">
            {CENTER_TABS.map((tab) => {
              const isActive = centerTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setCenterTab(tab.id)}
                  className={`${TAB_BASE_CLASS} px-4 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
                >
                  {tab.label}
                  {tab.id === 'logs' && <span className="text-theme-xs text-gray-400">({careLogs.length}{careLogsState.hasMore ? '+' : ''})</span>}
                </button>
              );
            })}
          </div>
          {centerTab === 'logs' ? (
            <>
              <CareLogForm key={customer.id} customer={customer} variant="desktop" />
              <CareTimeline careLogs={careLogs} isLoading={careLogsState.isLoading} hasMore={careLogsState.hasMore} isLoadingMore={careLogsState.isFetchingMore} onLoadMore={careLogsState.loadMore} onImageError={careLogsState.refetch} customerId={customer.id} />
            </>
          ) : (
            <HistoryList customerId={customer.id} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <UpcomingAppointmentsSection customerId={customer.id} />
          <CriteriaBoard customer={customer} />
          <CareTeamCard customer={customer} />
          <NextStepNotice suggestions={customer.nextActionSuggestions} />
        </div>
      </div>
    </div>
  );
};

export default CustomerDetailDesktop;
