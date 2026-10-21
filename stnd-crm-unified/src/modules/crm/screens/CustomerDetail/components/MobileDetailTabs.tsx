// Thanh chuyển tab con (Mobile CustomerDetailView): Thông tin KH / Tiến độ / Nhật ký.
// Dùng mẫu tab gạch chân của Admin (như desktop) thay điều khiển phân đoạn nền xám của Stitch.
import { TAB_ACTIVE_CLASS, TAB_BASE_CLASS, TAB_INACTIVE_CLASS } from '@crm/lib/uiClasses';

export type MobileDetailTab = 'info' | 'progress' | 'timeline';

interface MobileDetailTabsProps {
  activeTab: MobileDetailTab;
  onChange: (tab: MobileDetailTab) => void;
}

const TAB_ITEMS: ReadonlyArray<{ id: MobileDetailTab; label: string }> = [
  { id: 'info', label: 'Thông tin KH' },
  { id: 'progress', label: 'Tiến độ' },
  { id: 'timeline', label: 'Nhật ký' },
];

export const MobileDetailTabs = ({ activeTab, onChange }: MobileDetailTabsProps) => (
  <div role="tablist" aria-label="Thông tin khách hàng" className="flex border-b border-gray-200 dark:border-white/[0.05]">
    {TAB_ITEMS.map((tab) => {
      const isActive = activeTab === tab.id;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(tab.id)}
          className={`${TAB_BASE_CLASS} flex-1 px-2 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
        >
          {tab.label}
        </button>
      );
    })}
  </div>
);
