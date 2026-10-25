/**
 * Quản lý nhóm (QT6, chỉ Quản trị) qua `/teams`: tạo nhóm, đổi tên/quản lý/ngừng hoạt động, xóa mềm (chỉ khi không còn thành viên:
 * 409 `TEAM_NOT_EMPTY`). Quản lý của nhóm xem được khách của cả nhóm; phạm vi dữ liệu do backend áp.
 */
import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAdminUsers, useCatalogs, useCrmApi } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { TextInput } from '@crm/components/form/TextInput';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { toggleItem } from '../../CreateCustomer/customerFormRules';
import { validateTeam, type TeamDraft } from '../settingsForms';
import { SwitchRow } from './CatalogItemEditor';

const fieldId = (name: string) => `settings-team-${name}`;

export const TeamsSection = () => {
  const { teams } = useCatalogs();
  const { data: users } = useAdminUsers();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<{ draft: TeamDraft; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const managers = users.filter((user) => user.role === 'MANAGER' && user.isActive);
  const nameOf = (userId: string) => users.find((user) => user.id === userId)?.displayName ?? 'Không rõ';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || isSaving) return;
    const { draft } = editing;
    const validationError = validateTeam(draft);
    if (validationError) {
      setEditing({ draft, error: validationError });
      return;
    }
    setIsSaving(true);
    const result =
      draft.id === null
        ? await api.createTeam({ name: draft.name.trim(), code: draft.code.trim(), managerIds: draft.managerIds })
        : await api.updateTeam(draft.id, { name: draft.name.trim(), managerIds: draft.managerIds, isActive: draft.isActive });
    setIsSaving(false);
    if (!result.ok) {
      setEditing({ draft, error: result.error.message });
      return;
    }
    showToast({ title: draft.id === null ? 'Đã tạo nhóm' : 'Đã lưu nhóm' });
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const result = await api.deleteTeam(deleting.id);
    showToast(result.ok ? { title: `Đã xoá nhóm "${deleting.name}"` } : { type: 'error', title: result.error.message });
    setDeleting(null);
  };

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>Nhóm bán hàng và người quản lý. Quản lý xem được khách của nhóm mình quản lý. Chỉ xoá được nhóm không còn thành viên.</p>
        {!editing && (
          <button type="button" onClick={() => setEditing({ draft: { id: null, name: '', code: '', managerIds: [], isActive: true }, error: null })} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
            <Plus size={16} aria-hidden="true" />
            Thêm nhóm
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={editing.draft.id === null ? 'Thêm nhóm' : 'Sửa nhóm'}>
          <h3 className={CARD_TITLE_CLASS}>{editing.draft.id === null ? 'Thêm nhóm' : `Sửa nhóm "${editing.draft.name}"`}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField inputId={fieldId('name')} label="Tên nhóm" isRequired>
              <TextInput id={fieldId('name')} value={editing.draft.name} maxLength={100} autoFocus onChange={(event) => setEditing({ draft: { ...editing.draft, name: event.target.value }, error: null })} />
            </FormField>
            {editing.draft.id === null && (
              <FormField inputId={fieldId('code')} label="Mã nhóm" isRequired hint="Chữ, số, - hoặc _, tối đa 20 ký tự; không đổi sau khi tạo">
                <TextInput id={fieldId('code')} value={editing.draft.code} maxLength={20} onChange={(event) => setEditing({ draft: { ...editing.draft, code: event.target.value }, error: null })} />
              </FormField>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Quản lý của nhóm</legend>
            {managers.length === 0 ? (
              <p className={MUTED_TEXT_CLASS}>Chưa có tài khoản Quản lý nào đang hoạt động.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {managers.map((manager) => {
                  const isSelected = editing.draft.managerIds.includes(manager.id);
                  return (
                    <label key={manager.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${isSelected ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400' : 'border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}>
                      <input type="checkbox" className="sr-only" checked={isSelected} onChange={() => setEditing({ draft: { ...editing.draft, managerIds: toggleItem(editing.draft.managerIds, manager.id) }, error: null })} />
                      {manager.displayName}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          {editing.draft.id !== null && (
            <div className="border-t border-gray-100 pt-3 dark:border-white/[0.05]">
              <SwitchRow label="Đang hoạt động" description="Tắt = ngừng nhóm" isChecked={editing.draft.isActive} onChange={(isActive) => setEditing({ draft: { ...editing.draft, isActive }, error: null })} />
            </div>
          )}
          <FieldError id={fieldId('error')} message={editing.error ?? undefined} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={BUTTON_OUTLINE_CLASS}>
              Huỷ
            </button>
            <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
              {isSaving ? 'Đang lưu…' : editing.draft.id === null ? 'Thêm' : 'Lưu'}
            </button>
          </div>
        </form>
      )}

      {teams.length === 0 && !editing && <p className={MUTED_TEXT_CLASS}>Chưa có nhóm nào. Tạo nhóm trước khi thêm Quản lý/Nhân viên.</p>}
      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {teams.map((team) => (
          <li key={team.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${team.isActive ? '' : 'opacity-60'}`}>
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                {team.name}
                <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>{team.code}</span>
                {!team.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Đã ngừng</span>}
              </p>
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                {team.memberCount} thành viên · Quản lý: {team.managerIds.length > 0 ? team.managerIds.map(nameOf).join(', ') : 'chưa có'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setEditing({ draft: { id: team.id, name: team.name, code: team.code, managerIds: team.managerIds, isActive: team.isActive }, error: null })} className={BUTTON_SOFT_SM_CLASS} aria-label={`Sửa nhóm ${team.name}`}>
                <Pencil size={12} aria-hidden="true" />
                Sửa
              </button>
              <button type="button" onClick={() => setDeleting({ id: team.id, name: team.name })} className={BUTTON_SOFT_SM_CLASS} aria-label={`Xoá nhóm ${team.name}`}>
                <Trash2 size={12} aria-hidden="true" />
                Xoá
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        isOpen={deleting !== null}
        tone="danger"
        title={`Xoá nhóm "${deleting?.name ?? ''}"?`}
        description="Chỉ xoá được nhóm không còn thành viên (xoá mềm). Nếu còn thành viên, hãy chuyển họ sang nhóm khác trước."
        confirmLabel="Xoá nhóm"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
};
