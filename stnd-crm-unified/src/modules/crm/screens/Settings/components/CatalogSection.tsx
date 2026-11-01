/**
 * Quản lý 1 danh mục (tình trạng / nguồn khách / khu vực) qua API `/crm/*` (Quản trị): danh sách + form thêm/sửa.
 * Không có nút xoá: mục đã dùng chỉ được ẩn (giữ dữ liệu lịch sử — X7); trùng mã/tên do server báo (409 `CATALOG_DUPLICATED`).
 */
import { useState } from 'react';
import { EyeOff, Pencil, Plus } from 'lucide-react';
import { useCatalogs, useCrmApi } from '@crm/api';
import { STATUS_TONE_STYLES } from '@crm/components/statusToneStyles';
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import {
  CATALOG_ENDPOINTS,
  createEmptyDraft,
  getItemName,
  sortCatalogItems,
  toCatalogBody,
  toDraft,
  validateDraft,
  type AdminCatalogItem,
  type AdminCatalogKind,
  type CatalogDraft,
} from '../settingsForms';
import { CatalogItemEditor } from './CatalogItemEditor';

interface CatalogSectionProps {
  kind: AdminCatalogKind;
  description: string;
}

interface EditingState {
  draft: CatalogDraft;
  error: string | null;
}

/** Dòng mô tả phụ của từng loại mục. */
const ItemMeta = ({ item }: { item: AdminCatalogItem }) => {
  if ('listGroup' in item) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP_SMALL_CLASS} ${STATUS_TONE_STYLES[item.tone].chipClass}`}>{LIST_GROUP_LABELS[item.listGroup]}</span>
        {item.isDefault && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Mặc định</span>}
        {item.isSystem && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Hệ thống</span>}
      </span>
    );
  }
  if ('code' in item && item.code) return <span className="text-theme-xs text-gray-500 dark:text-gray-400">Mã: {item.code}</span>;
  return null;
};

export const CatalogSection = ({ kind, description }: CatalogSectionProps) => {
  const { catalogs } = useCatalogs();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const items = catalogs[kind] as readonly AdminCatalogItem[];
  const sortedItems = sortCatalogItems(items);
  const endpoint = CATALOG_ENDPOINTS[kind];

  /** Lưu bản nháp (tạo: POST; sửa: PATCH). Trả `true` khi thành công. */
  const save = async (draft: CatalogDraft, successTitle: string): Promise<boolean> => {
    const validationError = validateDraft(kind, draft);
    if (validationError) {
      setEditing((previous) => (previous ? { ...previous, error: validationError } : previous));
      return false;
    }
    setIsSaving(true);
    const body = toCatalogBody(kind, draft);
    const result = draft.id === null ? await api.createCatalogItem(endpoint, body) : await api.updateCatalogItem(endpoint, draft.id, body);
    setIsSaving(false);
    if (!result.ok) {
      if (editing) setEditing({ ...editing, error: result.error.message });
      else showToast({ type: 'error', title: result.error.message });
      return false;
    }
    showToast({ title: successTitle });
    return true;
  };

  const toggleActive = async (item: AdminCatalogItem) => {
    const name = getItemName(item);
    await save({ ...toDraft(item), isActive: !item.isActive }, item.isActive ? `Đã ẩn "${name}"` : `Đã dùng lại "${name}"`);
  };

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>{description}</p>
        {!editing && (
          <button type="button" onClick={() => setEditing({ draft: createEmptyDraft(items), error: null })} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
            <Plus size={16} aria-hidden="true" />
            Thêm
          </button>
        )}
      </div>

      {editing && (
        <CatalogItemEditor
          kind={kind}
          draft={editing.draft}
          error={editing.error}
          isSaving={isSaving}
          onChange={(draft) => setEditing({ draft, error: null })}
          onCancel={() => setEditing(null)}
          onSave={async () => {
            if (await save(editing.draft, editing.draft.id === null ? 'Đã thêm mục mới' : 'Đã lưu thay đổi')) setEditing(null);
          }}
        />
      )}

      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {sortedItems.map((item) => (
          <li key={item.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${item.isActive ? '' : 'opacity-60'}`}>
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                {'label' in item ? item.label : item.name}
                {!item.isActive && (
                  <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                    <EyeOff size={12} aria-hidden="true" />
                    Đã ẩn
                  </span>
                )}
              </p>
              <ItemMeta item={item} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => void toggleActive(item)} disabled={isSaving} className={BUTTON_SOFT_SM_CLASS} aria-label={`${item.isActive ? 'Ẩn' : 'Dùng lại'} ${getItemName(item)}`}>
                {item.isActive ? 'Ẩn' : 'Dùng lại'}
              </button>
              <button type="button" onClick={() => setEditing({ draft: toDraft(item), error: null })} className={BUTTON_SOFT_SM_CLASS} aria-label={`Sửa ${getItemName(item)}`}>
                <Pencil size={12} aria-hidden="true" />
                Sửa
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
