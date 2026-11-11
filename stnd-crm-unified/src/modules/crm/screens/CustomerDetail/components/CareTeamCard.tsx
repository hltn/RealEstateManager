/**
 * "Nhóm chăm sóc" (C8, v1.0.5): người chăm sóc chính (PRIMARY) = chủ khách, bị KHÓA — không đổi, không gỡ (409 PRIMARY_LOCKED).
 * Thành viên phụ (MEMBER) tối đa 10: mời nhiều người một lần qua `CareTeamInvitePicker` (chỉ tên + nhóm, không email/SĐT), gỡ từng người.
 * Khách chưa có nhóm (`careTeam` rỗng): Quản trị/Quản lý (`permissions.canSetInitialPrimary`) đặt người chăm sóc chính MỘT LẦN, sau đó khóa.
 * Không còn đề nghị tham gia nhóm (đã bỏ ở backend v1.0.5).
 */
import { useState } from 'react';
import { Check, Crown, Lock, Plus, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import { useCrmActor, useCrmApi, type ApiError, type CustomerDetail } from '@crm/api';
import { CareTeamInvitePicker } from '@crm/components/CareTeamInvitePicker';
import { countCareTeamMembers, describeCareTeamError, findNonAssignableUserIds, MAX_CARE_TEAM_MEMBERS } from '@crm/lib/customerRules';
import { BUTTON_DASHED_CLASS, BUTTON_PRIMARY_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { useCrmRawState } from '@crm/store/hooks';
import { CardHeading, CareTeamAvatars } from './DetailParts';

interface CareTeamCardProps {
  customer: CustomerDetail;
}

/** `invite`: mời thành viên phụ; `primary`: đặt người chăm sóc chính một lần cho khách chưa có nhóm. */
type OpenBox = 'invite' | 'primary' | null;

const SELF_OPTION_LABEL = 'Chính tôi';

const describeAddError = (error: ApiError): string => (error.errorCode === 'CARE_TEAM_LIMIT_EXCEEDED' || error.errorCode === 'ALREADY_IN_CARE_TEAM' ? `Không thêm được: ${describeCareTeamError(error.errorCode)}.` : error.message);

export const CareTeamCard = ({ customer }: CareTeamCardProps) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const actor = useCrmActor();
  const { users } = useCrmRawState();
  const [openBox, setOpenBox] = useState<OpenBox>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { permissions, careTeam } = customer;
  const hasPrimary = careTeam.some((member) => member.role === 'PRIMARY');
  const memberCount = countCareTeamMembers(careTeam);
  const remainingSlots = Math.max(0, MAX_CARE_TEAM_MEMBERS - memberCount);
  const isFull = remainingSlots === 0;
  const canInvite = permissions.canManageCareTeam && hasPrimary;
  const canSetPrimary = permissions.canSetInitialPrimary && !hasPrimary;
  // `care-team-invitees` loại chính người gọi, nên Quản lý tự nhận phụ trách phải có lựa chọn riêng. Quản trị thuần không chăm sóc được (QT6) → không hiện, tránh USER_NOT_ASSIGNABLE.
  const canPickSelf = canSetPrimary && actor.userId !== '' && findNonAssignableUserIds(users, [actor.userId]).length === 0;

  const closeBox = () => {
    setOpenBox(null);
    setSelectedIds([]);
    setAddError(null);
  };

  const submit = async () => {
    if (selectedIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setAddError(null);
    // Chỉ lần đặt người chăm sóc chính đầu tiên (khách chưa có PRIMARY, người gọi có quyền) mới gửi `primaryUserId`; mời thêm thì không bao giờ gửi (backend 400).
    const primaryUserId = hasPrimary || !permissions.canSetInitialPrimary ? undefined : selectedIds[0];
    const result = await api.addCareTeamMembers(customer.id, { userIds: selectedIds, primaryUserId });
    setIsSubmitting(false);
    if (!result.ok) {
      setAddError(describeAddError(result.error));
      return;
    }
    showToast({ title: primaryUserId ? 'Đã đặt người chăm sóc chính' : `Đã mời ${selectedIds.length} thành viên vào nhóm chăm sóc` });
    closeBox();
  };

  const removeMember = async (userId: string, displayName: string) => {
    const result = await api.removeCareTeamMember(customer.id, userId);
    showToast(result.ok ? { title: `Đã gỡ ${displayName} khỏi nhóm chăm sóc` } : { type: 'error', title: result.error.message });
  };

  return (
    <section aria-label="Nhóm chăm sóc" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading icon={UsersRound} title="Nhóm chăm sóc" as="h3" trailing={<CareTeamAvatars members={careTeam} />} />

      {careTeam.length === 0 ? (
        <p className={MUTED_TEXT_CLASS}>Chưa có người chăm sóc chính.</p>
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
                    {member.user.isLocked && <span className="shrink-0 text-theme-xs font-normal text-gray-400">(đã khóa)</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                    {isPrimary ? (
                      <>
                        <span>Người chăm sóc chính</span>
                        <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Chủ khách</span>
                        <span className="inline-flex items-center gap-1" title="Người chăm sóc chính được giữ cố định, không đổi hoặc gỡ">
                          <Lock size={12} aria-hidden="true" />
                          cố định
                        </span>
                      </>
                    ) : (
                      <span>Thành viên phụ</span>
                    )}
                    {member.user.jobTitle && <span>· {member.user.jobTitle}</span>}
                  </p>
                </div>
                {!isPrimary && permissions.canManageCareTeam && (
                  <button
                    type="button"
                    aria-label={`Gỡ ${member.user.displayName} khỏi nhóm chăm sóc`}
                    title="Gỡ khỏi nhóm"
                    onClick={() => void removeMember(member.user.id, member.user.displayName)}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasPrimary && (
        <p className={MUTED_TEXT_CLASS} aria-label="Số thành viên phụ">
          {memberCount}/{MAX_CARE_TEAM_MEMBERS} thành viên phụ
        </p>
      )}

      {openBox === null && canSetPrimary && (
        <button type="button" onClick={() => setOpenBox('primary')} className={BUTTON_DASHED_CLASS}>
          <UserPlus size={12} aria-hidden="true" />
          Đặt người chăm sóc chính
        </button>
      )}
      {openBox === null && canInvite && (
        <>
          <button type="button" onClick={() => setOpenBox('invite')} disabled={isFull} className={BUTTON_DASHED_CLASS}>
            <Plus size={12} aria-hidden="true" />
            Mời thành viên
          </button>
          {isFull && <p className={MUTED_TEXT_CLASS}>Đã đủ {MAX_CARE_TEAM_MEMBERS} thành viên phụ, hãy gỡ bớt trước khi mời thêm.</p>}
        </>
      )}

      {openBox !== null && (
        <div className="space-y-3">
          <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {openBox === 'primary' ? 'Chọn người chăm sóc chính (chỉ đặt một lần, sau đó bị khóa)' : `Chọn người để mời (còn tối đa ${remainingSlots})`}
          </p>
          <CareTeamInvitePicker
            customerId={customer.id}
            idPrefix={`care-team-${openBox}`}
            selectionMode={openBox === 'primary' ? 'single' : 'multiple'}
            maxSelectable={openBox === 'invite' ? remainingSlots : undefined}
            selectedIds={selectedIds}
            onSelectedChange={setSelectedIds}
            pinnedOption={openBox === 'primary' && canPickSelf ? { id: actor.userId, label: SELF_OPTION_LABEL } : undefined}
          />
          {addError && (
            <p role="alert" className="text-theme-xs font-medium text-error-600 dark:text-error-400">
              {addError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void submit()} disabled={selectedIds.length === 0 || isSubmitting} className={`${BUTTON_PRIMARY_CLASS} shrink-0`}>
              <Check size={16} aria-hidden="true" />
              {openBox === 'primary' ? 'Đặt làm người chăm sóc chính' : `Mời${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}`}
            </button>
            <button type="button" onClick={closeBox} aria-label="Huỷ" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
