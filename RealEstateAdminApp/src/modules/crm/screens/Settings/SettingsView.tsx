/**
 * Màn "Cài đặt CRM" (X7 — chỉ Quản trị; CrmLayout chặn vai trò khác). Dùng chung desktop + mobile.
 * Mọi form (tạo/sửa khách, bộ lọc, Dự án, Báo cáo) đọc danh mục từ CÙNG store nên thay đổi ở đây áp dụng ngay.
 */
import { useState } from 'react';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS, PAGE_TITLE_MOBILE_CLASS, TAB_ACTIVE_CLASS, TAB_BASE_CLASS, TAB_INACTIVE_CLASS } from '@crm/lib/uiClasses';
import { CatalogSection } from './components/CatalogSection';
import { ReminderSettingsSection } from './components/ReminderSettingsSection';
import { UsersSection } from './components/UsersSection';
import { SETTINGS_TABS, type SettingsTab } from './settingsForms';

const CATALOG_DESCRIPTIONS: Record<Exclude<SettingsTab, 'users' | 'reminders'>, string> = {
  statuses:
    'Tình trạng khách và danh sách tương ứng (Đang chăm sóc / Khách net / Bỏ). Tình trạng hệ thống không ẩn được nếu là mặc định hoặc là tình trạng cuối của 1 danh sách.',
  leadSources: 'Nguồn khách dùng khi tạo khách, lọc danh sách và báo cáo.',
  areas: 'Khu vực khách đang sinh sống (prototype: danh sách phẳng).',
  projects: 'Danh mục dự án dùng chung cho hồ sơ khách, lịch hẹn, màn Dự án và báo cáo.',
};

interface SettingsViewProps {
  variant: 'desktop' | 'mobile';
}

export const SettingsView = ({ variant }: SettingsViewProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('statuses');
  const isDesktop = variant === 'desktop';

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h2 className={isDesktop ? PAGE_TITLE_CLASS : PAGE_TITLE_MOBILE_CLASS}>Cài đặt CRM</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>Danh mục, người dùng và nhắc việc. Mục đã dùng chỉ được ẩn, không xoá.</p>
        </header>
        {isDesktop && <CrmModuleTabs />}
      </div>

      <div role="tablist" aria-label="Nhóm cài đặt" className="-mx-4 flex gap-5 overflow-x-auto border-b border-gray-200 px-4 sm:mx-0 sm:px-0 dark:border-white/[0.05]">
        {SETTINGS_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls="settings-panel"
              onClick={() => setActiveTab(tab.id)}
              className={`${TAB_BASE_CLASS} ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`}>
        {activeTab === 'users' && <UsersSection />}
        {activeTab === 'reminders' && <ReminderSettingsSection />}
        {activeTab !== 'users' && activeTab !== 'reminders' && <CatalogSection key={activeTab} kind={activeTab} description={CATALOG_DESCRIPTIONS[activeTab]} />}
      </div>
    </div>
  );
};
