/**
 * Quản lý 1 danh mục (tình trạng / nguồn khách / khu vực / dự án): danh sách + số khách đang dùng + form thêm/sửa.
 * Không có nút xoá: mục đã dùng chỉ được ẩn (giữ dữ liệu lịch sử — X7).
 */
import { useState } from 'react';
import { EyeOff, Pencil, Plus } from 'lucide-react';
import { useCatalogs, useCatalogUsage, useCrmApi, type AdminCatalogKind } from '@crm/api';
import { STATUS_TONE_STYLES } from '@crm/components/statusToneStyles';
import { createId } from '@crm/lib/id';
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { CrmCatalogs } from '@crm/types/crm';
import { createEmptyCatalogItem, normalizeCatalogItem, sortCatalogItems, type AdminCatalogItem } from '../settingsForms';
import { CatalogItemEditor } from './CatalogItemEditor';

const ID_PREFIX: Record<AdminCatalogKind, string> = { statuses: 'st', leadSources: 'src', areas: 'area', projects: 'proj' };

interface CatalogSectionProps {
  kind: AdminCatalogKind;
  description: string;
}

interface EditingState {
  item: AdminCatalogItem;
  isNew: boolean;
  error: string | null;
}

const getName = (item: AdminCatalogItem): string => ('label' in item ? item.label : item.name);

/** Dòng mô tả phụ của từng loại mục. */
const ItemMeta = ({ item, areaName }: { item: AdminCatalogItem; areaName?: string }) => {
  if ('listGroup' in item) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP_SMALL_CLASS} ${STATUS_TONE_STYLES[item.tone].chipClass}`}>{LIST_GROUP_LABELS[item.listGroup]}</span>
        {item.isDefault && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Mặc định</span>}
        {item.isSystem && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Hệ thống</span>}
      </span>
    );
  }
  if ('fullName' in item) {
    const parts = [item.code, item.segment, item.statusLabel, areaName].filter(Boolean);
    return parts.length > 0 ? <span className="text-theme-xs text-gray-500 dark:text-gray-400">{parts.join(' · ')}</span> : null;
  }
  return null;
};

export const CatalogSection = ({ kind, description }: CatalogSectionProps) => {
  const { catalogs } = useCatalogs();
  const { data: usage } = useCatalogUsage(kind);
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const items = catalogs[kind] as readonly AdminCatalogItem[];
  const sortedItems = sortCatalogItems(items);

  const save = (item: AdminCatalogItem, successTitle: string): boolean => {
    const normalized = normalizeCatalogItem(kind, item);
    const result = api.upsertCatalogItem(kind, normalized as CrmCatalogs[typeof kind][number]);
    if (!result.ok) {
      setEditing((previous) => (previous ? { ...previous, error: result.error.message } : previous));
      if (!editing) showToast({ type: 'error', title: result.error.message });
      return false;
    }
    showToast({ title: successTitle });
    return true;
  };

  const startCreate = () => setEditing({ item: createEmptyCatalogItem(kind, items, createId(ID_PREFIX[kind])), isNew: true, error: null });

  const toggleActive = (item: AdminCatalogItem) => {
    const name = getName(item);
    save({ ...item, isActive: !item.isActive }, item.isActive ? `Đã ẩn "${name}"` : `Đã dùng lại "${name}"`);
  };

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>{description}</p>
        {!editing && (
          <button type="button" onClick={startCreate} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
            <Plus size={16} aria-hidden="true" />
            Thêm
          </button>
        )}
      </div>

      {editing && (
        <CatalogItemEditor
          kind={kind}
          item={editing.item}
          isNew={editing.isNew}
          error={editing.error}
          onChange={(item) => setEditing({ ...editing, item, error: null })}
          onCancel={() => setEditing(null)}
          onSave={() => {
            if (save(editing.item, editing.isNew ? 'Đã thêm mục mới' : 'Đã lưu thay đổi')) setEditing(null);
          }}
        />
      )}

      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {sortedItems.map((item) => {
          const usageCount = usage.get(item.id) ?? 0;
          const areaName = 'areaId' in item && item.areaId ? catalogs.areas.find((area) => area.id === item.areaId)?.name : undefined;
          return (
            <li key={item.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${item.isActive ? '' : 'opacity-60'}`}>
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                  {getName(item)}
                  {!item.isActive && (
                    <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                      <EyeOff size={12} aria-hidden="true" />
                      Đã ẩn
                    </span>
                  )}
                </p>
                <ItemMeta item={item} areaName={areaName} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">{usageCount} khách</span>
                <button type="button" onClick={() => toggleActive(item)} className={BUTTON_SOFT_SM_CLASS} aria-label={`${item.isActive ? 'Ẩn' : 'Dùng lại'} ${getName(item)}`}>
                  {item.isActive ? 'Ẩn' : 'Dùng lại'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ item, isNew: false, error: null })}
                  className={BUTTON_SOFT_SM_CLASS}
                  aria-label={`Sửa ${getName(item)}`}
                >
                  <Pencil size={12} aria-hidden="true" />
                  Sửa
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
