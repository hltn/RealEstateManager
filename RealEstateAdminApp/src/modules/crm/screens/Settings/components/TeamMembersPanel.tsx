/**
 * Thành viên của MỘT nhóm (mở ngay dưới dòng nhóm để không mất ngữ cảnh): danh sách có tìm theo tên + phân trang; Quản trị thêm/gỡ
 * thành viên, Quản lý chỉ xem. Gỡ thành viên KHÔNG đổi danh sách Quản lý của nhóm (đổi riêng ở form Sửa nhóm); thêm cần người có
 * vai trò Quản lý/Nhân viên. Sau thêm/gỡ, số thành viên của nhóm và danh sách người dùng được làm mới (xem `useCrmApi`).
 */
import { useMemo, useState } from 'react';
import { Search, UserMinus, UserPlus } from 'lucide-react';
import { useCrmApi, useTeamMembers } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { FieldError } from '@crm/components/form/FieldError';
import { SearchableSelect } from '@crm/components/form/SearchableSelect';
import { TextInput } from '@crm/components/form/TextInput';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { ACCOUNT_ROLE_LABELS } from '@crm/lib/roles';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { AdminUser, TeamMember } from '@crm/types/crm';
import { normalizeRoles } from '../../../../../utils/userRoles';
import { listAddableUsers } from '../settingsForms';

const PAGE_SIZE = 10;

interface TeamMembersPanelProps {
  team: { id: string; name: string; isActive: boolean };
  /** Chỉ Quản trị thấy Thêm/Gỡ. */
  canManage: boolean;
  /** Danh sách tài khoản để chọn khi thêm (chỉ cần khi `canManage`). */
  users: readonly AdminUser[];
}

export const TeamMembersPanel = ({ team, canManage, users }: TeamMembersPanelProps) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pickedUserId, setPickedUserId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const keyword = useDebouncedValue(searchText.trim(), 350);
  const { data, isLoading, isFetching, isError, error, refetch } = useTeamMembers(team.id, { page, limit: PAGE_SIZE, q: keyword || undefined });
  const addableOptions = useMemo(() => listAddableUsers(users, team.id).map((user) => ({ value: user.id, label: `${user.displayName} (${user.roles.map((role) => ACCOUNT_ROLE_LABELS[role]).join(', ')})` })), [users, team.id]);
  const { meta } = data;

  const addMember = async () => {
    if (!pickedUserId || isAdding) return;
    setIsAdding(true);
    setAddError(null);
    const result = await api.addTeamMember(team.id, pickedUserId);
    setIsAdding(false);
    if (!result.ok) return setAddError(result.error.message);
    showToast({ title: `Đã thêm ${result.data.displayName} vào nhóm "${team.name}"` });
    setPickedUserId('');
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const member = removing;
    setRemoving(null);
    const result = await api.removeTeamMember(team.id, member.id);
    if (!result.ok) return showToast({ type: 'error', title: result.error.message });
    showToast({ title: `Đã gỡ ${member.displayName} khỏi nhóm "${team.name}"${member.isManager ? ". Người này vẫn là Quản lý của nhóm" : ""}` });
    // Gỡ người cuối của trang cuối thì lùi một trang để không đứng ở trang trống.
    if (data.data.length === 1 && page > 1) setPage(page - 1);
  };

  return (
    <div className={`${INSET_CLASS} mt-3 space-y-3 p-3 sm:p-4`} role="region" aria-label={`Thành viên nhóm ${team.name}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <TextInput icon={Search} value={searchText} placeholder="Tìm thành viên theo tên" aria-label="Tìm thành viên" className="sm:max-w-xs" onChange={(event) => { setSearchText(event.target.value); setPage(1); }} />
        <p className={MUTED_TEXT_CLASS}>{meta.total} thành viên</p>
      </div>

      {canManage && (
        <div className="space-y-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <SearchableSelect id={`team-${team.id}-add-member`} aria-label="Chọn người để thêm vào nhóm" listLabel="Người có thể thêm" options={addableOptions} value={pickedUserId} emptyLabel="Chọn người để thêm" disabled={!team.isActive} onChange={(value) => { setPickedUserId(value); setAddError(null); }} />
            </div>
            <button type="button" onClick={() => void addMember()} disabled={!pickedUserId || isAdding || !team.isActive} className={`${BUTTON_PRIMARY_CLASS} shrink-0`}>
              <UserPlus size={16} aria-hidden="true" />
              {isAdding ? 'Đang thêm…' : 'Thêm thành viên'}
            </button>
          </div>
          {!team.isActive && <p className={MUTED_TEXT_CLASS}>Nhóm đã ngừng hoạt động nên không thêm được thành viên.</p>}
          {team.isActive && addableOptions.length === 0 && <p className={MUTED_TEXT_CLASS}>Mọi tài khoản Quản lý/Nhân viên đang hoạt động đều đã thuộc nhóm này.</p>}
          <FieldError id={`team-${team.id}-add-error`} message={addError ?? undefined} />
        </div>
      )}

      {isLoading && <div aria-busy="true" aria-label="Đang tải thành viên" className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
      {isError && (
        <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400">
          {error?.message}{' '}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Thử lại
          </button>
        </p>
      )}
      {!isLoading && !isError && data.data.length === 0 && <p className={MUTED_TEXT_CLASS}>{keyword ? 'Không có thành viên nào khớp.' : 'Nhóm chưa có thành viên.'}</p>}
      <ul className={`divide-y divide-gray-100 dark:divide-white/[0.05] ${isFetching && !isLoading ? 'opacity-70' : ''}`} aria-label="Danh sách thành viên">
        {data.data.map((member) => (
          <li key={member.id} className={`flex items-center justify-between gap-2 py-2 ${member.isActive ? '' : 'opacity-60'}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-gray-800 dark:text-white/90">{member.displayName}</span>
              {normalizeRoles(member.roles).map((role) => (
                <span key={role} className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                  {ACCOUNT_ROLE_LABELS[role as keyof typeof ACCOUNT_ROLE_LABELS]}
                </span>
              ))}
              {member.isManager && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Quản lý nhóm</span>}
              {!member.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Đã khoá</span>}
            </div>
            {canManage && (
              <button type="button" onClick={() => setRemoving(member)} className={BUTTON_SOFT_SM_CLASS} aria-label={`Gỡ ${member.displayName} khỏi nhóm`}>
                <UserMinus size={12} aria-hidden="true" />
                Gỡ
              </button>
            )}
          </li>
        ))}
      </ul>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={BUTTON_OUTLINE_CLASS} disabled={page <= 1 || isFetching} onClick={() => setPage(page - 1)}>
            Trang trước
          </button>
          <span className={MUTED_TEXT_CLASS}>
            Trang {meta.page}/{meta.totalPages}
          </span>
          <button type="button" className={BUTTON_OUTLINE_CLASS} disabled={page >= meta.totalPages || isFetching} onClick={() => setPage(page + 1)}>
            Trang sau
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={removing !== null}
        tone="danger"
        title={`Gỡ ${removing?.displayName ?? ''} khỏi nhóm "${team.name}"?`}
        description={removing?.isManager ? 'Người này vẫn là Quản lý của nhóm (đổi ở form Sửa nhóm). Gỡ khỏi nhóm không đổi vai trò của họ; phạm vi khách theo nhóm được tính lại.' : 'Gỡ khỏi nhóm không đổi vai trò của họ; phạm vi khách theo nhóm được tính lại.'}
        confirmLabel="Gỡ khỏi nhóm"
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
};
