// Chi tiết khách trên điện thoại (02 §7): chia tab Thông tin / Nhật ký / Tiến độ; nút Ghi chú, Gọi và Zalo cố định đáy (PT-028).
// Màn chi tiết là sub view -> CrmLayout KHÔNG hiện `CrmBottomNav`; chừa đáy `6rem + safe-area` (cao hơn thanh đáy ~73px + vùng home indicator iPhone)
// cho thanh CTA đáy để phần cuối form ghi chú / danh sách vẫn cuộn lên khỏi thanh đáy.
import { useState } from 'react';
import { useCareLogs, useCustomerDetail } from '@crm/api';
import { CustomerLoadState } from '@crm/components/CustomerLoadState';
import { TAB_ACTIVE_CLASS, TAB_BASE_CLASS, TAB_INACTIVE_CLASS } from '@crm/lib/uiClasses';
import { hasPhone } from '@crm/lib/phone';
import { useCrmState } from '@crm/store';
import { CareLogComposer } from './components/CareLogComposer';
import { CareTeamCard } from './components/CareTeamCard';
import { CareTimeline } from './components/CareTimeline';
import { CriteriaBoard } from './components/CriteriaBoard';
import { CustomerHeader } from './components/CustomerHeader';
import { CustomerInfoCard } from './components/CustomerInfoCard';
import { NextStepNotice } from './components/DetailParts';
import { HistoryList } from './components/HistoryList';
import { MobileContactFooter } from './components/MobileContactFooter';
import { MobileDetailHeader } from './components/MobileDetailHeader';
import { UpcomingAppointmentsSection } from './components/UpcomingAppointmentsSection';
import { PersonaCard, RealEstateNeedsCard } from './components/PersonaCards';
import { useNoteComposer } from './useNoteComposer';

type MobileTab = 'info' | 'logs' | 'progress';

const TAB_ITEMS: { id: MobileTab; label: string }[] = [
  { id: 'info', label: 'Thông tin' },
  { id: 'logs', label: 'Nhật ký' },
  { id: 'progress', label: 'Tiến độ' },
];

export const CustomerDetailMobile = () => {
  const { selectedCustomerId } = useCrmState();
  const { data: customer, isLoading, isNotFound, error, refetch } = useCustomerDetail(selectedCustomerId);
  const primaryUserId = customer?.careTeam.find((member) => member.role === 'PRIMARY')?.user.id ?? null;
  const careLogsState = useCareLogs(selectedCustomerId, primaryUserId);
  const careLogs = careLogsState.data;
  const [activeTab, setActiveTab] = useState<MobileTab>('info');
  const noteComposer = useNoteComposer(selectedCustomerId ?? '');
  // Tăng mỗi lần bấm "Ghi chú" khi form thêm mới ĐÃ mở sẵn (không dựng lại) để form cuộn vào vùng nhìn thấy + focus lại.
  const [noteFocusSignal, setNoteFocusSignal] = useState(0);

  if (!customer) return <CustomerLoadState variant="mobile" title="Chi tiết khách hàng" isLoading={isLoading} isNotFound={isNotFound} error={error} onRetry={refetch} />;

  // "Ghi chú" ở thẻ đầu hồ sơ và ở thanh đáy (mọi tab): sang tab Nhật ký và mở form đầy đủ (PT-020, PT-028).
  // Form thêm mới đã mở sẵn (có thể đang có nháp, đang ẩn ở tab khác): `openCreate` giữ nguyên nháp và không dựng lại form nên phải báo form cuộn + focus lại.
  // Các trường hợp còn lại tự xử lý: đóng -> form mới mount (cuộn + focus); đang sửa nhật ký -> dựng form mới hoặc hỏi lại (hộp xác nhận lo tiêu điểm).
  const handleAddNote = () => {
    setActiveTab('logs');
    if (noteComposer.state.kind === 'create') setNoteFocusSignal((signal) => signal + 1);
    noteComposer.openCreate();
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-[calc(6rem+env(safe-area-inset-bottom))]" data-testid="customer-detail-mobile">
      <MobileDetailHeader customerCode={customer.customerCode} />
      <CustomerHeader
        customer={customer}
        variant="mobile"
        onAddNote={handleAddNote}
      />

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
          <UpcomingAppointmentsSection customerId={customer.id} />
          <CustomerInfoCard customer={customer} />
          <PersonaCard customer={customer} />
          <RealEstateNeedsCard customer={customer} />
        </>
      )}

      {/* Form ghi chú LUÔN được dựng (chỉ ẩn khi không ở tab Nhật ký): đổi tab giữa chừng không làm mất bản nháp/ảnh đã tải lên. */}
      {/* `empty:hidden`: form đóng thì vùng này rỗng, không để lại khoảng cách thừa (gap) giữa các khối. */}
      <div hidden={activeTab !== 'logs'} className="empty:hidden">
        <CareLogComposer key={customer.id} customer={customer} variant="mobile" composer={noteComposer} focusSignal={noteFocusSignal} />
      </div>

      {activeTab === 'logs' && (
        <>
          <CareTimeline careLogs={careLogs} isLoading={careLogsState.isLoading} hasMore={careLogsState.hasMore} isLoadingMore={careLogsState.isFetchingMore} onLoadMore={careLogsState.loadMore} onImageError={careLogsState.refetch} customerId={customer.id} onEdit={noteComposer.openEdit} />
          <HistoryList customerId={customer.id} isCollapsible />
        </>
      )}

      {activeTab === 'progress' && (
        <>
          <CriteriaBoard customer={customer} />
          <CareTeamCard customer={customer} />
          <NextStepNotice suggestions={customer.nextActionSuggestions} />
        </>
      )}

      <MobileContactFooter customerId={customer.id} hasPhone={hasPhone(customer.phoneMasked)} onAddNote={handleAddNote} />
    </div>
  );
};

export default CustomerDetailMobile;
