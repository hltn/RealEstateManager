/**
 * Render modal toàn cục theo `state.activeModal` (1 modal tại 1 thời điểm).
 * Màn hình KHÔNG tự render các modal này - chỉ gọi action mở modal:
 *   openQuickNote(id), openLightbox(images, index), openAdvancedFilter(),
 *   hoặc useContactActions().callCustomer(id) / messageZalo(id).
 * CallModal / ZaloModal chỉ render khi bật cờ tương ứng trong `config/featureFlags.ts` (mặc định tắt).
 */
import { useCrmApi, useCustomerDetail, useCustomerPersona } from '@crm/api';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { useIsMobile } from '@crm/hooks/useIsMobile';
import { getPersonaText } from '@crm/lib/customerRules';
import { useCrmActions, useCrmState, useCurrentUser } from '@crm/store';
import { AdvancedFilterModal } from './AdvancedFilterModal';
import { CallModal, type ContactTarget } from './CallModal';
import { LightboxModal } from './LightboxModal';
import { QuickNoteModal } from './QuickNoteModal';
import { ZaloModal } from './ZaloModal';

export const GlobalModals = () => {
  const { activeModal, filters } = useCrmState();
  const actions = useCrmActions();
  const api = useCrmApi();
  const currentUser = useCurrentUser();
  const isMobile = useIsMobile();
  const modalCustomerId = activeModal && 'customerId' in activeModal ? activeModal.customerId : null;
  const { data: customer } = useCustomerDetail(modalCustomerId);
  const { data: persona } = useCustomerPersona(modalCustomerId);

  if (!activeModal) return null;

  const contactTarget: ContactTarget | null = customer
    ? {
        name: customer.fullName,
        phone: customer.phone,
        preferredSalutation: getPersonaText(persona?.values ?? [], 'salutation'),
        interestedProjects: customer.projects.map((project) => project.label),
        staffName: currentUser.displayName,
      }
    : null;

  const logContact = (contactChannel: 'CALL' | 'ZALO', content: string, title: string) => {
    if (!customer) return;
    const result = api.createCareLog(customer.id, { content, contactChannel });
    actions.showToast(result.ok ? { title } : { type: 'error', title: result.error.message });
  };

  switch (activeModal.kind) {
    case 'call':
      return CRM_FEATURE_FLAGS.isInAppCallEnabled && contactTarget ? (
        <CallModal
          key={modalCustomerId}
          customer={contactTarget}
          onClose={actions.closeModal}
          onSaveLog={({ note, callOutcome }) => logContact('CALL', `${callOutcome}: ${note}`, 'Đã lưu cuộc gọi vào nhật ký chăm sóc')}
        />
      ) : null;

    case 'zalo':
      return CRM_FEATURE_FLAGS.isZaloZnsEnabled && contactTarget ? (
        <ZaloModal
          key={modalCustomerId}
          customer={contactTarget}
          onClose={actions.closeModal}
          onSent={({ message }) => logContact('ZALO', `[Zalo ZNS đã gửi]: "${message}"`, `Đã gửi Zalo cho ${contactTarget.name}`)}
        />
      ) : null;

    case 'quick_note':
      return customer ? (
        <QuickNoteModal key={customer.id} customer={customer} variant={isMobile ? 'sheet' : 'dialog'} onClose={actions.closeModal} />
      ) : null;

    case 'lightbox':
      return (
        <LightboxModal
          images={activeModal.images}
          startIndex={activeModal.startIndex}
          title={activeModal.title}
          variant={isMobile ? 'fullscreen' : 'dialog'}
          onClose={actions.closeModal}
        />
      );

    case 'advanced_filter':
      return (
        <AdvancedFilterModal
          filters={filters}
          variant={isMobile ? 'sheet' : 'dialog'}
          onClose={actions.closeModal}
          onApply={(nextFilters) => {
            actions.setFilters(nextFilters);
            actions.showToast({ title: 'Đã áp dụng bộ lọc nâng cao' });
          }}
          onReset={() => {
            actions.resetFilters();
            actions.showToast({ title: 'Đã đặt lại bộ lọc' });
          }}
        />
      );

    default:
      return null;
  }
};
