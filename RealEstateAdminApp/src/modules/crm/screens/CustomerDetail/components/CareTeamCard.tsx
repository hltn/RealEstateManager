// "Nhóm chăm sóc" (C8, QT7, X2): thành viên (★ = phụ trách chính), thêm/bớt người, đổi phụ trách chính,
// duyệt đề nghị tham gia. Quyền theo ma trận 04 §4.2: thêm/gỡ thành viên = Quản trị, Quản lý, phụ trách chính;
// đổi/gỡ phụ trách chính = Quản trị, Quản lý (gỡ phải chọn người thay). Luôn còn đúng 1 phụ trách chính.
import { useState } from 'react';
import { Check, Crown, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { useAssignableUsers, useCareTeamRequests, useCrmApi, type ApiResult, type CustomerDetail } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { BUTTON_DASHED_CLASS, BUTTON_LINK_CLASS, BUTTON_PRIMARY_CLASS, CARD_CLASS, INSET_CLASS, MUTED_TEXT_CLASS, SOLID_INPUT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { CardHeading, CareTeamAvatars } from './DetailParts';

interface CareTeamCardProps {
  customer: CustomerDetail;
}

export const CareTeamCard = ({ customer }: CareTeamCardProps) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const { data: assignableUsers } = useAssignableUsers();
  const [isAdding, setIsAdding] = useState(false);
  const [newMemberId, setNewMemberId] = useState('');
  const [removingPrimaryId, setRemovingPrimaryId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const { permissions, careTeam } = customer;
  const { data: requests } = useCareTeamRequests('to-review', permissions.canReviewJoinRequests);
  const hasPrimary = careTeam.some((member) => member.role === 'PRIMARY');
  const candidates = assignableUsers.filter((user) => !careTeam.some((member) => member.user.id === user.id));
  const pendingRequests = requests.filter((request) => request.customerId === customer.id && request.status === 'PENDING');

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
      api.addCareTeamMembers(customer.id, { userIds: [newMemberId], primaryUserId: hasPrimary ? undefined : newMemberId }),
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
                  {!isPrimary && permissions.canChangePrimary && (
                    <button
                      type="button"
                      onClick={() => handle(api.changePrimary(customer.id, member.user.id), `Đã đổi phụ trách chính sang ${member.user.displayName}`)}
                      className={BUTTON_LINK_CLASS}
                      title="Đặt làm phụ trách chính"
                    >
                      <Crown size={12} aria-hidden="true" />
                      Đặt chính
                    </button>
                  )}
                  {(isPrimary ? permissions.canChangePrimary : permissions.canManageCareTeam) && (
                    <button
                      type="button"
                      aria-label={`Gỡ ${member.user.displayName} khỏi nhóm chăm sóc`}
                      title="Gỡ khỏi nhóm"
                      onClick={() => {
                        if (isPrimary) {
                          setRemovingPrimaryId(member.user.id);
                          setReplacementId('');
                          return;
                        }
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
                  {user.fullName}
                  {user.team ? ` (${user.team.label})` : ''}
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

      {permissions.canReviewJoinRequests && pendingRequests.length > 0 && (
        <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-50 p-3 dark:border-brand-500/25 dark:bg-brand-500/10">
          <p className="text-theme-xs font-semibold text-brand-600 dark:text-brand-400">Đề nghị tham gia nhóm chăm sóc</p>
          {pendingRequests.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-theme-xs">
              <span className="text-gray-700 dark:text-gray-300">
                <strong>{request.requester.displayName}</strong> · {formatVnDateTime(request.createdAt)}
                {request.message && <span className="block italic text-gray-500">“{request.message}”</span>}
              </span>
              <span className="flex gap-1">
                <button type="button" onClick={() => handle(api.resolveCareTeamRequest(request.id, 'APPROVED'), 'Đã duyệt đề nghị tham gia')} className={BUTTON_LINK_CLASS}>
                  Duyệt
                </button>
                <button type="button" onClick={() => handle(api.resolveCareTeamRequest(request.id, 'REJECTED'), 'Đã từ chối đề nghị')} className={`${BUTTON_LINK_CLASS} text-error-500`}>
                  Từ chối
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={removingPrimaryId !== null}
        title="Gỡ người phụ trách chính"
        description="Mỗi khách phải có đúng một người phụ trách chính. Chọn người thay thế trước khi gỡ."
        confirmLabel="Gỡ và thay người"
        tone="danger"
        onCancel={() => setRemovingPrimaryId(null)}
        onConfirm={async () => {
          if (!removingPrimaryId) return;
          if (!replacementId) {
            showToast({ type: 'error', title: 'Vui lòng chọn người phụ trách chính thay thế.' });
            return;
          }
          if (await handle(api.removeCareTeamMember(customer.id, removingPrimaryId, replacementId), 'Đã gỡ và đổi người phụ trách chính')) {
            setRemovingPrimaryId(null);
          }
        }}
      >
        <select value={replacementId} onChange={(event) => setReplacementId(event.target.value)} aria-label="Người phụ trách chính thay thế" className={SOLID_INPUT_CLASS}>
          <option value="">— Chọn người thay thế —</option>
          {[...careTeam.filter((member) => member.user.id !== removingPrimaryId).map((member) => member.user), ...candidates]
            .filter((user, index, list) => list.findIndex((item) => item.id === user.id) === index)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
        </select>
      </ConfirmDialog>
    </section>
  );
};
