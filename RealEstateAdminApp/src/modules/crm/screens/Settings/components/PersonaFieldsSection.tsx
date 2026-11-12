/**
 * Quản lý trường chân dung (FR-41, chỉ Quản trị) qua `/crm/persona-fields`: danh sách theo 7 nhóm, thêm trường mới (kiểu, lựa chọn,
 * trọng số, lọc được, nhạy cảm), sửa nhãn và lựa chọn của SELECT/MULTI_SELECT (lựa chọn vắng bị TẮT chứ không xóa), bật/tắt trường,
 * đổi thứ tự trong nhóm, xóa trường không phải hệ thống. Sau mỗi thao tác `useCrmApi` làm mới danh mục `persona-fields` nên form
 * chân dung và bộ lọc thấy ngay. Backend vẫn là nguồn sự thật về quyền (403) và mọi quy tắc (lỗi hiển thị theo `errorCode`).
 */
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { canViewSettings, useAdminPersonaFields, useCrmActor, useCrmApi } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { AdminPersonaField } from '@crm/types/crm';
import {
  PERSONA_FIELD_TYPE_LABELS,
  buildCreatePersonaFieldBody,
  buildMoveOrderItems,
  buildPersonaFieldPatch,
  canDeletePersonaField,
  createEmptyCreateDraft,
  describePersonaFieldError,
  groupPersonaFields,
  summarizeOptions,
  toPersonaFieldDraft,
  validateCreateDraft,
  validatePersonaFieldDraft,
  type MoveDirection,
  type PersonaFieldCreateDraft,
  type PersonaFieldDraft,
} from '../personaFieldForms';
import { PersonaFieldCreateForm } from './PersonaFieldCreateForm';
import { PersonaFieldEditor } from './PersonaFieldEditor';

interface EditingState {
  field: AdminPersonaField;
  draft: PersonaFieldDraft;
  error: string | null;
}

interface CreatingState {
  draft: PersonaFieldCreateDraft;
  error: string | null;
}

/** Nhóm mặc định của form thêm trường (Quản trị đổi được trong form). */
const DEFAULT_NEW_FIELD_GROUP = 'PERSONAL';

export const PersonaFieldsSection = () => {
  const { role } = useCrmActor();
  const isAdmin = canViewSettings(role);
  // Không phải Quản trị thì không gọi API (backend cũng trả 403): chỉ hiện thông báo.
  const { data: fields, isLoading, error: loadError, refetch } = useAdminPersonaFields(isAdmin);
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [deleting, setDeleting] = useState<AdminPersonaField | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Chốt đồng bộ: `isSaving` (state) chỉ cập nhật sau khi render lại nên bấm đúp hai lần liên tiếp vẫn lọt qua; ref chặn ngay lập tức.
  const isBusyRef = useRef(false);

  if (!isAdmin) {
    return (
      <section className={`${CARD_CLASS} p-4 sm:p-5`}>
        <p role="alert" className={MUTED_TEXT_CLASS}>Chỉ Quản trị mới quản lý được trường chân dung.</p>
      </section>
    );
  }

  const groups = groupPersonaFields(fields);

  /** Chạy một thao tác ghi tối đa một lần tại một thời điểm: đang có thao tác khác thì bỏ qua yêu cầu mới. */
  const runExclusive = async (task: () => Promise<void>) => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsSaving(true);
    try {
      await task();
    } finally {
      isBusyRef.current = false;
      setIsSaving(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setCreating({ draft: createEmptyCreateDraft(DEFAULT_NEW_FIELD_GROUP), error: null });
  };

  const openEdit = (field: AdminPersonaField) => {
    setCreating(null);
    setEditing({ field, draft: toPersonaFieldDraft(field), error: null });
  };

  const handleSave = async () => {
    if (!editing || isBusyRef.current) return;
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
    await runExclusive(async () => {
      const result = await api.updatePersonaField(field.id, patch);
      if (!result.ok) {
        const message = describePersonaFieldError(result.error);
        setEditing((current) => (current ? { ...current, error: message } : current));
        return;
      }
      showToast({ title: `Đã lưu trường "${result.data.label}"` });
      setEditing(null);
    });
  };

  const handleCreate = async () => {
    if (!creating || isBusyRef.current) return;
    const validationError = validateCreateDraft(creating.draft);
    if (validationError) {
      setCreating({ ...creating, error: validationError });
      return;
    }
    const body = buildCreatePersonaFieldBody(creating.draft);
    await runExclusive(async () => {
      const result = await api.createPersonaField(body);
      if (!result.ok) {
        const message = describePersonaFieldError(result.error);
        setCreating((current) => (current ? { ...current, error: message } : current));
        return;
      }
      showToast({ title: `Đã thêm trường "${result.data.label}"` });
      setCreating(null);
    });
  };

  const handleDelete = async () => {
    const target = deleting;
    if (!target || isBusyRef.current) return;
    await runExclusive(async () => {
      const result = await api.deletePersonaField(target.id);
      showToast(result.ok ? { title: `Đã xoá trường "${target.label}"` } : { type: 'error', title: describePersonaFieldError(result.error) });
      setDeleting(null);
      // Đang sửa đúng trường vừa xóa thì đóng form sửa (không còn gì để lưu).
      if (result.ok) setEditing((current) => (current?.field.id === target.id ? null : current));
    });
  };

  const handleToggleActive = async (field: AdminPersonaField, isActive: boolean) => {
    await runExclusive(async () => {
      const result = await api.updatePersonaField(field.id, { isActive });
      showToast(result.ok ? { title: `Đã ${isActive ? 'bật' : 'tắt'} trường "${field.label}"` } : { type: 'error', title: describePersonaFieldError(result.error) });
    });
  };

  const handleMove = async (field: AdminPersonaField, direction: MoveDirection) => {
    const items = buildMoveOrderItems(fields, field.id, direction);
    if (!items) return;
    await runExclusive(async () => {
      const result = await api.reorderPersonaFields(items);
      if (!result.ok) showToast({ type: 'error', title: describePersonaFieldError(result.error) });
    });
  };

  return (
    <section className={`${CARD_CLASS} space-y-5 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
          Các trường trong chân dung khách. Thêm trường, đổi nhãn/lựa chọn, tắt hoặc đổi thứ tự có hiệu lực ngay ở form chân dung. Dữ liệu khách đã nhập luôn được giữ: lựa chọn bị tắt chỉ ẩn khỏi lựa chọn mới, trường bị tắt chỉ ẩn khỏi form.
        </p>
        <button type="button" onClick={openCreate} disabled={creating !== null} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
          <Plus size={16} aria-hidden="true" />
          Thêm trường
        </button>
      </div>

      {creating && (
        <PersonaFieldCreateForm
          draft={creating.draft}
          error={creating.error}
          isSaving={isSaving}
          onChange={(draft) => setCreating({ ...creating, draft, error: null })}
          onSave={() => void handleCreate()}
          onCancel={() => setCreating(null)}
        />
      )}

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
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void handleMove(field, 'up')} disabled={isSaving || index === 0} className={BUTTON_SOFT_SM_CLASS} aria-label={`Chuyển lên: ${field.label}`}>
                    <ArrowUp size={12} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => void handleMove(field, 'down')} disabled={isSaving || index === group.fields.length - 1} className={BUTTON_SOFT_SM_CLASS} aria-label={`Chuyển xuống: ${field.label}`}>
                    <ArrowDown size={12} aria-hidden="true" />
                  </button>
                  <ToggleSwitch isChecked={field.isActive} onChange={(isActive) => void handleToggleActive(field, isActive)} label={`Bật trường ${field.label}`} size="sm" isDisabled={isSaving} />
                  <button type="button" onClick={() => openEdit(field)} className={BUTTON_SOFT_SM_CLASS} aria-label={`Sửa trường ${field.label}`}>
                    <Pencil size={12} aria-hidden="true" />
                    Sửa
                  </button>
                  {canDeletePersonaField(field) && (
                    <button type="button" onClick={() => setDeleting(field)} disabled={isSaving} className={BUTTON_SOFT_SM_CLASS} aria-label={`Xoá trường ${field.label}`}>
                      <Trash2 size={12} aria-hidden="true" />
                      Xoá
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ConfirmDialog
        isOpen={deleting !== null}
        tone="danger"
        title={`Xoá trường "${deleting?.label ?? ''}"?`}
        description="Trường bị xoá mềm: biến khỏi form chân dung và bộ lọc. Mã trường vẫn được giữ chỗ nên không thể tạo lại một trường trùng mã. Nếu chỉ muốn ẩn tạm, hãy tắt trường thay vì xoá."
        confirmLabel="Xoá trường"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
};
