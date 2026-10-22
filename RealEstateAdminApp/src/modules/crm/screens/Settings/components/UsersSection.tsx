/**
 * Quản lý người dùng mock (X7): họ tên, vai trò, nhóm, khoá/mở. Không xoá cứng — khoá tài khoản thay vì xoá.
 * Đổi vai trò Quản lý tự đồng bộ "quản lý nhóm" (phạm vi dữ liệu QT6).
 */
import { useState, type FormEvent } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { useCatalogs, useCrmApi } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { createId } from '@crm/lib/id';
import { ROLE_LABELS } from '@crm/lib/roles';
import {
  BUTTON_OUTLINE_CLASS,
  BUTTON_PRIMARY_CLASS,
  BUTTON_SOFT_SM_CLASS,
  CARD_CLASS,
  CARD_TITLE_CLASS,
  CHIP_SMALL_CLASS,
  CHIP_TONE_CLASS,
  INSET_CLASS,
  MUTED_TEXT_CLASS,
} from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { CrmUser, UserRole } from '@crm/types/crm';
import { createEmptyUser, normalizeUser, ROLE_OPTIONS } from '../settingsForms';
import { SwitchRow } from './CatalogItemEditor';

interface EditingUser {
  user: CrmUser;
  isNew: boolean;
  error: string | null;
}

const fieldId = (name: string) => `settings-user-${name}`;

const ROLE_TONE: Record<UserRole, string> = { ADMIN: CHIP_TONE_CLASS.error, MANAGER: CHIP_TONE_CLASS.brand, STAFF: CHIP_TONE_CLASS.gray };

export const UsersSection = () => {
  const { users, teams } = useCatalogs();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [editing, setEditing] = useState<EditingUser | null>(null);
  const teamName = (teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? '—';

  const save = (user: CrmUser): boolean => {
    const result = api.upsertUser(normalizeUser(user));
    if (!result.ok) {
      if (editing) setEditing({ ...editing, error: result.error.message });
      else showToast({ type: 'error', title: result.error.message });
      return false;
    }
    showToast({ title: `Đã lưu người dùng ${result.data.fullName}` });
    return true;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (editing && save(editing.user)) setEditing(null);
  };

  const update = (changes: Partial<CrmUser>) => editing && setEditing({ ...editing, user: { ...editing.user, ...changes }, error: null });

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
          Người dùng mô phỏng để chọn người chăm sóc và kiểm tra phân quyền. Khoá tài khoản thay vì xoá; người đang phụ trách chính khách cần được chuyển
          trước khi khoá.
        </p>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing({ user: createEmptyUser(createId('user'), teams[0]?.id ?? null), isNew: true, error: null })}
            className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}
          >
            <UserPlus size={16} aria-hidden="true" />
            Thêm người dùng
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={editing.isNew ? 'Thêm người dùng' : 'Sửa người dùng'}>
          <h3 className={CARD_TITLE_CLASS}>{editing.isNew ? 'Thêm người dùng' : `Sửa ${editing.user.fullName}`}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField inputId={fieldId('full-name')} label="Họ tên" isRequired>
              <TextInput id={fieldId('full-name')} value={editing.user.fullName} maxLength={80} autoFocus onChange={(event) => update({ fullName: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('display-name')} label="Tên hiển thị" hint="Bỏ trống = lấy tên cuối">
              <TextInput id={fieldId('display-name')} value={editing.user.displayName} maxLength={30} onChange={(event) => update({ displayName: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('job-title')} label="Chức danh">
              <TextInput id={fieldId('job-title')} value={editing.user.jobTitle} maxLength={60} onChange={(event) => update({ jobTitle: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('role')} label="Vai trò">
              <SelectInput id={fieldId('role')} value={editing.user.role} options={ROLE_OPTIONS} onChange={(event) => update({ role: event.target.value as UserRole })} />
            </FormField>
            {editing.user.role !== 'ADMIN' && (
              <FormField inputId={fieldId('team')} label="Nhóm" isRequired hint={editing.user.role === 'MANAGER' ? 'Quản lý xem được khách của cả nhóm này' : undefined}>
                <SelectInput
                  id={fieldId('team')}
                  value={editing.user.teamId ?? ''}
                  emptyLabel="Chọn nhóm"
                  options={teams.map((team) => ({ value: team.id, label: team.name }))}
                  onChange={(event) => update({ teamId: event.target.value || null })}
                />
              </FormField>
            )}
          </div>
          <div className="border-t border-gray-100 pt-3 dark:border-white/[0.05]">
            <SwitchRow
              label="Đang hoạt động"
              description="Tắt = khoá tài khoản; không chọn được làm người chăm sóc mới"
              isChecked={editing.user.isActive}
              onChange={(isActive) => update({ isActive })}
            />
          </div>
          <FieldError id={fieldId('error')} message={editing.error ?? undefined} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={BUTTON_OUTLINE_CLASS}>
              Huỷ
            </button>
            <button type="submit" className={BUTTON_PRIMARY_CLASS}>
              {editing.isNew ? 'Thêm' : 'Lưu'}
            </button>
          </div>
        </form>
      )}

      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {users.map((user) => (
          <li key={user.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${user.isActive ? '' : 'opacity-60'}`}>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                {user.fullName} <span className="font-normal text-gray-500 dark:text-gray-400">({user.displayName})</span>
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                <span className={`${CHIP_SMALL_CLASS} ${ROLE_TONE[user.role]}`}>{ROLE_LABELS[user.role]}</span>
                {user.role !== 'ADMIN' && <span>{teamName(user.teamId)}</span>}
                {user.jobTitle && <span>· {user.jobTitle}</span>}
                {!user.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Đã khoá</span>}
              </p>
            </div>
            <button type="button" onClick={() => setEditing({ user, isNew: false, error: null })} className={`${BUTTON_SOFT_SM_CLASS} self-start sm:self-auto`} aria-label={`Sửa ${user.fullName}`}>
              <Pencil size={12} aria-hidden="true" />
              Sửa
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
