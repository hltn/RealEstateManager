/**
 * Render modal toàn cục theo `state.activeModal` (1 modal tại 1 thời điểm).
 * Màn hình KHÔNG tự render các modal này - chỉ gọi action mở modal:
 *   openQuickNote(id), openLightbox(images, index), openAdvancedFilter(),
 *   hoặc useContactActions().callCustomer(id) / messageZalo(id).
 */
import { useIsMobile } from '@crm/hooks/useIsMobile';
import { useCrmActions, useCrmState, useCustomer } from '@crm/store';
import { AdvancedFilterModal } from './AdvancedFilterModal';
import { CallModal } from './CallModal';
import { LightboxModal } from './LightboxModal';
import { QuickNoteModal } from './QuickNoteModal';
import { ZaloModal } from './ZaloModal';

export const GlobalModals = () => {
  const { activeModal, filters } = useCrmState();
  const actions = useCrmActions();
  const isMobile = useIsMobile();
  const modalCustomer = useCustomer(activeModal && 'customerId' in activeModal ? activeModal.customerId : null);

  if (!activeModal) return null;

  switch (activeModal.kind) {
    case 'call':
      return modalCustomer ? (
        <CallModal
          key={modalCustomer.id}
          customer={modalCustomer}
          onClose={actions.closeModal}
          onSaveLog={(input) => actions.logCallResult({ customerId: modalCustomer.id, ...input })}
        />
      ) : null;

    case 'zalo':
      return modalCustomer ? (
        <ZaloModal
          key={modalCustomer.id}
          customer={modalCustomer}
          onClose={actions.closeModal}
          onSent={(input) => actions.logZaloMessage({ customerId: modalCustomer.id, ...input })}
        />
      ) : null;

    case 'quick_note':
      return modalCustomer ? (
        <QuickNoteModal
          key={modalCustomer.id}
          customer={modalCustomer}
          variant={isMobile ? 'sheet' : 'dialog'}
          onClose={actions.closeModal}
          onSave={(input) => actions.saveQuickNote({ customerId: modalCustomer.id, ...input })}
        />
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
            actions.showToast({ title: 'Đã áp dụng bộ lọc nâng cao!' });
          }}
          onReset={() => {
            actions.resetAdvancedFilters();
            actions.showToast({ title: 'Đã đặt lại bộ lọc mặc định' });
          }}
        />
      );

    default:
      return null;
  }
};
