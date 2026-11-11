// "Nhóm chăm sóc" (C8): thành viên (★ = phụ trách chính), thêm/bớt người cùng chăm sóc.
// v1.0.5: PRIMARY bị khóa (không đổi/gỡ), không còn luồng xin tham gia; người mời lấy từ `useCareTeamInvitees`.
// TODO(T-28): thiết kế lại thẻ (tìm người mời có phân trang, đặt PRIMARY lần đầu, nhãn khóa).
import { useState } from 'react';
import { Check, Crown, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { useCareTeamInvitees, useCrmApi, type ApiResult, type CustomerDetail } from '@crm/api';
import { BUTTON_DASHED_CLASS, BUTTON_PRIMARY_CLASS, CARD_CLASS, INSET_CLASS, MUTED_TEXT_CLASS, SOLID_INPUT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { CardHeading, CareTeamAvatars } from './DetailParts';

interface CareTeamCardProps {
  customer: CustomerDetail;
}

export const CareTeamCard = ({ customer }: CareTeamCardProps) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [isAdding, setIsAdding] = useState(false);
  const [newMemberId, setNewMemberId] = useState('');
  const { permissions, careTeam } = customer;
  const { data: invitees } = useCareTeamInvitees(customer.id, '', 1, permissions.canManageCareTeam || permissions.canSetInitialPrimary);
  const hasPrimary = careTeam.some((member) => member.role === 'PRIMARY');
  const candidates = invitees.data.filter((user) => !careTeam.some((member) => member.user.id === user.id));

  const handle = async <T,>(pending: Promise<ApiResult<T>>, successTitle: string): Promise<boolean> => {
    const result = await pending;
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return false;
    }
    showToast({ title: successTitle });
    return true;
  };

  const addMember = async () => {
    if (!newMemberId) return;
    // Khách chưa có phụ trách chính: người đầu tiên được thêm là phụ trách chính (bắt buộc chọn khi phân lần đầu).
    const isSaved = await handle(
      api.addCareTeamMembers(customer.id, { userIds: [newMemberId], primaryUserId: hasPrimary || !permissions.canSetInitialPrimary ? undefined : newMemberId }),
      hasPrimary ? 'Đã thêm người cùng chăm sóc' : 'Đã phân người phụ trách chính',
    );
    if (isSaved) {
      setNewMemberId('');
      setIsAdding(false);
    }
  };

  return (
    <section aria-label="Nhóm chăm sóc" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading icon={UsersRound} title="Nhóm chăm sóc" as="h3" trailing={<CareTeamAvatars members={careTeam} />} />

      {careTeam.length === 0 ? (
        <p className={MUTED_TEXT_CLASS}>Chưa phân người chăm sóc.</p>
      ) : (
        <ul className="space-y-2">
          {careTeam.map((member) => {
            const isPrimary = member.role === 'PRIMARY';
            return (
              <li key={member.user.id} className={`${INSET_CLASS} flex items-center justify-between gap-2 p-2.5`}>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {isPrimary && <Crown size={14} aria-hidden="true" className="shrink-0 text-warning-500" />}
                    <span className="truncate">{member.user.fullName}</span>
                  </p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {isPrimary ? 'Phụ trách chính' : 'Cùng chăm sóc'}
                    {member.user.jobTitle && ` · ${member.user.jobTitle}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!isPrimary && permissions.canManageCareTeam && (
                    <button
                      type="button"
                      aria-label={`Gỡ ${member.user.displayName} khỏi nhóm chăm sóc`}
                      title="Gỡ khỏi nhóm"
                      onClick={() => {
                        handle(api.removeCareTeamMember(customer.id, member.user.id), `Đã gỡ ${member.user.displayName} khỏi nhóm chăm sóc`);
                      }}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {permissions.canManageCareTeam &&
        (isAdding ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={newMemberId} onChange={(event) => setNewMemberId(event.target.value)} aria-label="Chọn người chăm sóc" className={SOLID_INPUT_CLASS}>
              <option value="">— Chọn người —</option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                  {user.teamNames.length > 0 ? ` (${user.teamNames.join(', ')})` : ''}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button type="button" onClick={addMember} disabled={!newMemberId} className={`${BUTTON_PRIMARY_CLASS} shrink-0`}>
                <Check size={16} aria-hidden="true" />
                Thêm
              </button>
              <button type="button" onClick={() => setIsAdding(false)} aria-label="Huỷ thêm người" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setIsAdding(true)} disabled={candidates.length === 0} className={BUTTON_DASHED_CLASS}>
            <Plus size={12} aria-hidden="true" />
            Thêm người
          </button>
        ))}
    </section>
  );
};
