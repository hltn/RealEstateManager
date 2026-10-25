/**
 * Quản lý tài khoản (X7, chỉ Quản trị) qua `/users`: tạo tài khoản (email + mật khẩu + vai trò + nhóm), đổi vai trò/nhóm,
 * khóa/mở khóa. Không xóa cứng — khóa tài khoản thay vì xóa. Backend chặn khóa/hạ quyền Quản trị cuối cùng (409 `LAST_ADMIN_REQUIRED`)
 * và tự đồng bộ phạm vi khách khi đổi nhóm/vai trò.
 */
import { useState, type FormEvent } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { useAdminUsers, useCatalogs, useCrmApi } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ROLE_LABELS } from '@crm/lib/roles';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { CrmUser, UserRole } from '@crm/types/crm';
import { createEmptyUserDraft, validateNewUser, type NewUserDraft } from '../settingsForms';
import { SwitchRow } from './CatalogItemEditor';

const fieldId = (name: string) => `settings-user-${name}`;
const ROLE_OPTIONS = (['STAFF', 'MANAGER', 'ADMIN'] as UserRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }));
const ROLE_TONE: Record<UserRole, string> = { ADMIN: CHIP_TONE_CLASS.error, MANAGER: CHIP_TONE_CLASS.brand, STAFF: CHIP_TONE_CLASS.gray };

type EditingState = { mode: 'create'; draft: NewUserDraft; error: string | null } | { mode: 'edit'; user: CrmUser; role: UserRole; teamId: string; isActive: boolean; error: string | null };

export const UsersSection = () => {
  const { teams } = useCatalogs();
  const { data: users, isLoading, error: loadError, refetch } = useAdminUsers();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const teamName = (teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? '—';

  const fail = (message: string) => setEditing((current) => (current ? { ...current, error: message } : current));

  const submitCreate = async (draft: NewUserDraft) => {
    const validationError = validateNewUser(draft);
    if (validationError) return fail(validationError);
    setIsSaving(true);
    const result = await api.createUser({ email: draft.email.trim().toLowerCase(), password: draft.password, displayName: draft.displayName.trim(), role: draft.role, ...(draft.role !== 'ADMIN' ? { teamId: draft.teamId } : {}) });
    setIsSaving(false);
    if (!result.ok) return fail(result.error.message);
    showToast({ title: `Đã tạo tài khoản ${result.data.displayName}` });
    setEditing(null);
  };

  /** Áp từng thay đổi (vai trò -> nhóm -> trạng thái); dừng ở lỗi đầu tiên và báo lỗi. */
  const submitEdit = async (state: Extract<EditingState, { mode: 'edit' }>) => {
    const { user, role, teamId, isActive } = state;
    if (role !== 'ADMIN' && !teamId) return fail('Chọn nhóm cho Quản lý/Nhân viên.');
    setIsSaving(true);
    const steps: (() => ReturnType<typeof api.updateUserRole>)[] = [];
    if (role !== user.role) steps.push(() => api.updateUserRole(user.id, role));
    if (role !== 'ADMIN' && (teamId || null) !== user.teamId) steps.push(() => api.updateUserTeam(user.id, teamId || null));
    if (isActive !== user.isActive) steps.push(() => api.updateUserStatus(user.id, isActive ? 'ACTIVE' : 'BLOCKED'));
    for (const step of steps) {
      const result = await step();
      if (!result.ok) {
        setIsSaving(false);
        return fail(result.error.message);
      }
    }
    setIsSaving(false);
    showToast({ title: steps.length > 0 ? `Đã lưu người dùng ${user.displayName}` : 'Không có thay đổi nào' });
    setEditing(null);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || isSaving) return;
    if (editing.mode === 'create') void submitCreate(editing.draft);
    else void submitEdit(editing);
  };

  const teamOptions = teams.filter((team) => team.isActive).map((team) => ({ value: team.id, label: team.name }));

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
          Tài khoản đăng nhập hệ thống. Khoá tài khoản thay vì xoá; người đang phụ trách khách cần được chuyển trước khi khoá. Quản lý/Nhân viên cần thuộc một nhóm.
        </p>
        {!editing && (
          <button type="button" onClick={() => setEditing({ mode: 'create', draft: createEmptyUserDraft(teamOptions[0]?.value ?? ''), error: null })} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
            <UserPlus size={16} aria-hidden="true" />
            Thêm người dùng
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={editing.mode === 'create' ? 'Thêm người dùng' : 'Sửa người dùng'}>
          <h3 className={CARD_TITLE_CLASS}>{editing.mode === 'create' ? 'Thêm người dùng' : `Sửa ${editing.user.displayName}`}</h3>
          {editing.mode === 'create' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField inputId={fieldId('email')} label="Email đăng nhập" isRequired>
                <TextInput id={fieldId('email')} type="email" value={editing.draft.email} autoFocus autoComplete="off" onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, email: event.target.value }, error: null })} />
              </FormField>
              <FormField inputId={fieldId('password')} label="Mật khẩu" isRequired hint="Tối thiểu 8 ký tự">
                <TextInput id={fieldId('password')} type="password" value={editing.draft.password} autoComplete="new-password" onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, password: event.target.value }, error: null })} />
              </FormField>
              <FormField inputId={fieldId('display-name')} label="Tên hiển thị" isRequired>
                <TextInput id={fieldId('display-name')} value={editing.draft.displayName} maxLength={60} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, displayName: event.target.value }, error: null })} />
              </FormField>
              <FormField inputId={fieldId('role')} label="Vai trò">
                <SelectInput id={fieldId('role')} value={editing.draft.role} options={ROLE_OPTIONS} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, role: event.target.value as NewUserDraft['role'] }, error: null })} />
              </FormField>
              {editing.draft.role !== 'ADMIN' && (
                <FormField inputId={fieldId('team')} label="Nhóm" isRequired hint={editing.draft.role === 'MANAGER' ? 'Quản lý xem được khách của cả nhóm mình quản lý' : undefined}>
                  <SelectInput id={fieldId('team')} value={editing.draft.teamId} emptyLabel="Chọn nhóm" options={teamOptions} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, teamId: event.target.value }, error: null })} />
                </FormField>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField inputId={fieldId('role')} label="Vai trò">
                  <SelectInput id={fieldId('role')} value={editing.role} options={ROLE_OPTIONS} onChange={(event) => setEditing({ ...editing, role: event.target.value as UserRole, error: null })} />
                </FormField>
                {editing.role !== 'ADMIN' && (
                  <FormField inputId={fieldId('team')} label="Nhóm" isRequired>
                    <SelectInput id={fieldId('team')} value={editing.teamId} emptyLabel="Chọn nhóm" options={teamOptions} onChange={(event) => setEditing({ ...editing, teamId: event.target.value, error: null })} />
                  </FormField>
                )}
              </div>
              <div className="border-t border-gray-100 pt-3 dark:border-white/[0.05]">
                <SwitchRow label="Đang hoạt động" description="Tắt = khoá tài khoản; không đăng nhập và không chọn được làm người chăm sóc mới" isChecked={editing.isActive} onChange={(isActive) => setEditing({ ...editing, isActive, error: null })} />
              </div>
            </>
          )}
          <FieldError id={fieldId('error')} message={editing.error ?? undefined} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={BUTTON_OUTLINE_CLASS}>
              Huỷ
            </button>
            <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
              {isSaving ? 'Đang lưu…' : editing.mode === 'create' ? 'Thêm' : 'Lưu'}
            </button>
          </div>
        </form>
      )}

      {isLoading && <div aria-busy="true" aria-label="Đang tải người dùng" className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
      {loadError && (
        <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400">
          {loadError.message}{' '}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Thử lại
          </button>
        </p>
      )}
      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {users.map((user) => (
          <li key={user.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${user.isActive ? '' : 'opacity-60'}`}>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">{user.displayName}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                <span className={`${CHIP_SMALL_CLASS} ${ROLE_TONE[user.role]}`}>{ROLE_LABELS[user.role]}</span>
                {user.role !== 'ADMIN' && <span>{teamName(user.teamId)}</span>}
                {!user.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Đã khoá</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing({ mode: 'edit', user, role: user.role, teamId: user.teamId ?? '', isActive: user.isActive, error: null })}
              className={`${BUTTON_SOFT_SM_CLASS} self-start sm:self-auto`}
              aria-label={`Sửa ${user.displayName}`}
            >
              <Pencil size={12} aria-hidden="true" />
              Sửa
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
