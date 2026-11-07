/**
 * Quản lý trường chân dung (FR-41, chỉ Quản trị, đợt 1) qua `/crm/persona-fields`: danh sách theo 7 nhóm, sửa nhãn và lựa chọn của
 * SELECT/MULTI_SELECT (lựa chọn vắng bị TẮT chứ không xóa), bật/tắt trường, đổi thứ tự trong nhóm. Sau mỗi thao tác `useCrmApi` làm mới
 * danh mục `persona-fields` nên form chân dung và bộ lọc thấy ngay. Backend vẫn là nguồn sự thật về quyền (403) và mọi quy tắc
 * (lỗi hiển thị theo `errorCode`). Thêm/bớt trường và đổi kiểu thuộc đợt 2 (T-64).
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil } from 'lucide-react';
import { canViewSettings, useAdminPersonaFields, useCrmActor, useCrmApi } from '@crm/api';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_SOFT_SM_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { AdminPersonaField } from '@crm/types/crm';
import {
  PERSONA_FIELD_TYPE_LABELS,
  buildMoveOrderItems,
  buildPersonaFieldPatch,
  describePersonaFieldError,
  groupPersonaFields,
  summarizeOptions,
  toPersonaFieldDraft,
  validatePersonaFieldDraft,
  type MoveDirection,
  type PersonaFieldDraft,
} from '../personaFieldForms';
import { PersonaFieldEditor } from './PersonaFieldEditor';

interface EditingState {
  field: AdminPersonaField;
  draft: PersonaFieldDraft;
  error: string | null;
}

export const PersonaFieldsSection = () => {
  const { role } = useCrmActor();
  const isAdmin = canViewSettings(role);
  // Không phải Quản trị thì không gọi API (backend cũng trả 403): chỉ hiện thông báo.
  const { data: fields, isLoading, error: loadError, refetch } = useAdminPersonaFields(isAdmin);
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isAdmin) {
    return (
      <section className={`${CARD_CLASS} p-4 sm:p-5`}>
        <p role="alert" className={MUTED_TEXT_CLASS}>Chỉ Quản trị mới quản lý được trường chân dung.</p>
      </section>
    );
  }

  const groups = groupPersonaFields(fields);

  const handleSave = async () => {
    if (!editing || isSaving) return;
    const { field, draft } = editing;
    const validationError = validatePersonaFieldDraft(draft, field.type);
    if (validationError) {
      setEditing({ ...editing, error: validationError });
      return;
    }
    const patch = buildPersonaFieldPatch(field, draft);
    // Không đổi gì thì không gọi API.
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    setIsSaving(true);
    const result = await api.updatePersonaField(field.id, patch);
    setIsSaving(false);
    if (!result.ok) {
      setEditing({ ...editing, error: describePersonaFieldError(result.error) });
      return;
    }
    showToast({ title: `Đã lưu trường "${result.data.label}"` });
    setEditing(null);
  };

  const handleToggleActive = async (field: AdminPersonaField, isActive: boolean) => {
    if (isSaving) return;
    setIsSaving(true);
    const result = await api.updatePersonaField(field.id, { isActive });
    setIsSaving(false);
    showToast(result.ok ? { title: `Đã ${isActive ? 'bật' : 'tắt'} trường "${field.label}"` } : { type: 'error', title: describePersonaFieldError(result.error) });
  };

  const handleMove = async (field: AdminPersonaField, direction: MoveDirection) => {
    const items = buildMoveOrderItems(fields, field.id, direction);
    if (!items || isSaving) return;
    setIsSaving(true);
    const result = await api.reorderPersonaFields(items);
    setIsSaving(false);
    if (!result.ok) showToast({ type: 'error', title: describePersonaFieldError(result.error) });
  };

  return (
    <section className={`${CARD_CLASS} space-y-5 p-4 sm:p-5`}>
      <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
        Các trường trong chân dung khách. Đổi nhãn/lựa chọn, tắt hoặc đổi thứ tự có hiệu lực ngay ở form chân dung. Dữ liệu khách đã nhập luôn được giữ: lựa chọn bị tắt chỉ ẩn khỏi lựa chọn mới, trường bị tắt chỉ ẩn khỏi form.
      </p>

      {editing && (
        <PersonaFieldEditor
          field={editing.field}
          draft={editing.draft}
          error={editing.error}
          isSaving={isSaving}
          onChange={(draft) => setEditing({ ...editing, draft, error: null })}
          onSave={() => void handleSave()}
          onCancel={() => setEditing(null)}
        />
      )}

      {isLoading && <div aria-busy="true" aria-label="Đang tải trường chân dung" className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
      {loadError && (
        <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400">
          {loadError.message}{' '}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Thử lại
          </button>
        </p>
      )}
      {!isLoading && !loadError && fields.length === 0 && <p className={MUTED_TEXT_CLASS}>Chưa có trường chân dung nào.</p>}

      {groups.map((group) => (
        <section key={group.code} aria-label={`Nhóm ${group.label}`} className="space-y-1">
          <h3 className={CARD_TITLE_CLASS}>{group.label}</h3>
          <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {group.fields.map((field, index) => (
              <li key={field.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className={`flex flex-wrap items-center gap-2 text-sm font-medium ${field.isActive ? 'text-gray-800 dark:text-white/90' : 'text-gray-400 dark:text-gray-500'}`}>
                    {field.label}
                    <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>{PERSONA_FIELD_TYPE_LABELS[field.type]}</span>
                    {field.isSystem && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Hệ thống</span>}
                    {!field.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.warning}`}>Đã tắt</span>}
                  </p>
                  {summarizeOptions(field) && <p className="text-theme-xs text-gray-500 dark:text-gray-400">{summarizeOptions(field)}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => void handleMove(field, 'up')} disabled={isSaving || index === 0} className={BUTTON_SOFT_SM_CLASS} aria-label={`Chuyển lên: ${field.label}`}>
                    <ArrowUp size={12} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => void handleMove(field, 'down')} disabled={isSaving || index === group.fields.length - 1} className={BUTTON_SOFT_SM_CLASS} aria-label={`Chuyển xuống: ${field.label}`}>
                    <ArrowDown size={12} aria-hidden="true" />
                  </button>
                  <ToggleSwitch isChecked={field.isActive} onChange={(isActive) => void handleToggleActive(field, isActive)} label={`Bật trường ${field.label}`} size="sm" isDisabled={isSaving} />
                  <button type="button" onClick={() => setEditing({ field, draft: toPersonaFieldDraft(field), error: null })} className={BUTTON_SOFT_SM_CLASS} aria-label={`Sửa trường ${field.label}`}>
                    <Pencil size={12} aria-hidden="true" />
                    Sửa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
};
