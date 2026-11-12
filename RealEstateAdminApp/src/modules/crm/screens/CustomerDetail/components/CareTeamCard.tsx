// "Nhóm chăm sóc" (C8, v1.0.5): người chăm sóc chính (PRIMARY) = chủ khách, cố định (không đổi/gỡ); chia sẻ chỉ bằng cách MỜI
// tối đa 10 thành viên phụ. Không còn luồng xin tham gia. Người để mời lấy từ `CareTeamInvitePicker` (tìm + phân trang, chỉ tải khi mở khung mời).
// Quản trị/Quản lý đặt người chăm sóc chính lần đầu có thêm lựa chọn "Chính tôi" (server không trả người gọi trong danh sách mời).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crown, Plus, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import { useAuthStore } from '../../../../../stores/auth.store';
import { hasTeamRole, rolesOf } from '../../../../../utils/userRoles';
import { useCrmActor, useCrmApi, type ApiResult, type CareTeamInvitee, type CareTeamMemberView, type CustomerDetail } from '@crm/api';
import { CareTeamInvitePicker } from '@crm/components/CareTeamInvitePicker';
import { countCareTeamMembers, describeCareTeamError, getRemainingMemberSlots, MAX_CARE_TEAM_MEMBERS } from '@crm/lib/careTeamRules';
import { BUTTON_DASHED_CLASS, BUTTON_PRIMARY_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { CardHeading, CareTeamAvatars } from './DetailParts';

interface CareTeamCardProps {
  customer: CustomerDetail;
}

/** Khung đang mở: mời thành viên phụ, hoặc đặt người chăm sóc chính lần đầu (khách chưa có nhóm). */
type PanelMode = 'invite' | 'primary';
/** Nơi trả focus sau khi đóng khung: nút đã mở khung, hoặc nút "Mời người" sau khi đặt PRIMARY thành công (nút đặt PRIMARY khi đó biến mất). */
type FocusTarget = PanelMode | 'afterPrimarySet';

const SELF_LABEL = 'Chính tôi';

const MemberRow = ({ member, canRemove, onRemove }: { member: CareTeamMemberView; canRemove: boolean; onRemove: () => void }) => {
  const isPrimary = member.role === 'PRIMARY';
  return (
    <li className={`${INSET_CLASS} flex items-center justify-between gap-2 p-2.5`}>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {isPrimary && <Crown size={14} aria-hidden="true" className="shrink-0 text-warning-500" />}
          <span className="truncate">{member.user.fullName}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
          <span>{isPrimary ? 'Phụ trách chính' : 'Cùng chăm sóc'}</span>
          {member.user.jobTitle && <span>· {member.user.jobTitle}</span>}
          {isPrimary && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Chủ khách</span>}
          {member.user.isLocked && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>đã khóa</span>}
        </p>
      </div>
      {canRemove && (
        <button
          type="button"
          aria-label={`Gỡ ${member.user.displayName} khỏi nhóm chăm sóc`}
          title="Gỡ khỏi nhóm"
          onClick={onRemove}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
};

export const CareTeamCard = ({ customer }: CareTeamCardProps) => {
  const api = useCrmApi();
  const actor = useCrmActor();
  const authUser = useAuthStore((state) => state.user);
  const { showToast } = useCrmActions();
  const [panel, setPanel] = useState<PanelMode | null>(null);
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  // Đóng khung thì trả focus về nút đã mở nó (nút chỉ có mặt khi khung đóng nên phải đợi render lại).
  const focusReturnRef = useRef<FocusTarget | null>(null);
  const [selected, setSelected] = useState<CareTeamInvitee[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { permissions, careTeam } = customer;

  const hasPrimary = careTeam.some((member) => member.role === 'PRIMARY');
  const memberCount = countCareTeamMembers(careTeam);
  const remainingSlots = getRemainingMemberSlots(careTeam);
  // Chỉ mời khi đã có người chăm sóc chính; đặt người chăm sóc chính lần đầu chỉ khi nhóm còn trống.
  const canInvite = permissions.canManageCareTeam && hasPrimary;
  const canSetInitialPrimary = permissions.canSetInitialPrimary && careTeam.length === 0;
  const isFull = remainingSlots === 0;
  // Tự đặt mình làm người chăm sóc chính (server loại người gọi khỏi danh sách mời): chỉ tài khoản có role MANAGER/STAFF
  // (Quản trị kiêm Quản lý thì có; Quản trị thuần không, backend từ chối USER_NOT_ASSIGNABLE).
  const canPickSelf = hasTeamRole(rolesOf(authUser ?? {}));
  const selfOption = useMemo<CareTeamInvitee | undefined>(
    () => (canPickSelf && actor.userId ? { id: actor.userId, displayName: SELF_LABEL, teamNames: [] } : undefined),
    [canPickSelf, actor.userId],
  );

  // Trả focus sau khi khung đóng. Sau khi đặt PRIMARY, nút "Mời người" chỉ xuất hiện khi dữ liệu khách tải lại: đợi đến khi có nút.
  useEffect(() => {
    const target = focusReturnRef.current;
    if (panel !== null || target === null) return;
    const button = (target === 'primary' ? primaryButtonRef : inviteButtonRef).current;
    if (!button) return;
    button.focus();
    focusReturnRef.current = null;
  }, [panel, canInvite]);

  const openPanel = (mode: PanelMode) => {
    focusReturnRef.current = null;
    setPanel(mode);
  };

  const closePanel = (target: FocusTarget | null = panel) => {
    focusReturnRef.current = target;
    setPanel(null);
    setSelected([]);
    setErrorMessage(null);
  };

  const handle = async <T,>(pending: Promise<ApiResult<T>>, successTitle: string): Promise<boolean> => {
    const result = await pending;
    if (!result.ok) {
      showToast({ type: 'error', title: describeCareTeamError(result.error) });
      return false;
    }
    showToast({ title: successTitle });
    return true;
  };

  const submit = async () => {
    if (!panel || selected.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const userIds = selected.map((invitee) => invitee.id);
    // Đặt người chăm sóc chính lần đầu: một lần, gửi kèm `primaryUserId` (sau đó bị khóa, không đổi/gỡ).
    const result = await api.addCareTeamMembers(customer.id, panel === 'primary' ? { userIds: [userIds[0]], primaryUserId: userIds[0] } : { userIds });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(describeCareTeamError(result.error));
      return;
    }
    showToast({ title: panel === 'primary' ? 'Đã đặt người chăm sóc chính' : `Đã mời ${userIds.length} người vào nhóm chăm sóc` });
    closePanel(panel === 'primary' ? 'afterPrimarySet' : panel);
  };

  return (
    <section aria-label="Nhóm chăm sóc" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading icon={UsersRound} title="Nhóm chăm sóc" as="h3" trailing={<CareTeamAvatars members={careTeam} />} />

      {careTeam.length === 0 ? (
        <p className={MUTED_TEXT_CLASS}>Chưa phân người chăm sóc.</p>
      ) : (
        <ul className="space-y-2">
          {careTeam.map((member) => (
            <MemberRow
              key={member.user.id}
              member={member}
              canRemove={member.role === 'MEMBER' && permissions.canManageCareTeam}
              onRemove={() => {
                void handle(api.removeCareTeamMember(customer.id, member.user.id), `Đã gỡ ${member.user.displayName} khỏi nhóm chăm sóc`);
              }}
            />
          ))}
        </ul>
      )}

      {hasPrimary && <p className="text-theme-xs text-gray-500 dark:text-gray-400">Người chăm sóc chính được cố định, không đổi hoặc gỡ được.</p>}

      {canInvite && (
        <p className="text-theme-xs font-medium text-gray-600 dark:text-gray-300">
          {memberCount}/{MAX_CARE_TEAM_MEMBERS} thành viên phụ
        </p>
      )}

      {panel === null && canSetInitialPrimary && (
        <button ref={primaryButtonRef} type="button" onClick={() => openPanel('primary')} className={BUTTON_DASHED_CLASS}>
          <UserPlus size={12} aria-hidden="true" />
          Đặt người chăm sóc chính
        </button>
      )}

      {panel === null && canInvite && (
        <div className="space-y-1.5">
          <button ref={inviteButtonRef} type="button" onClick={() => openPanel('invite')} disabled={isFull} className={`${BUTTON_DASHED_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}>
            <Plus size={12} aria-hidden="true" />
            Mời người
          </button>
          {isFull && (
            <p role="status" className="text-theme-xs text-gray-500 dark:text-gray-400">
              Nhóm đã đủ {MAX_CARE_TEAM_MEMBERS} thành viên phụ, hãy gỡ bớt trước khi mời thêm.
            </p>
          )}
        </div>
      )}

      {panel !== null && (
        <div className="space-y-3">
          <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{panel === 'primary' ? 'Chọn người chăm sóc chính' : 'Mời người vào nhóm chăm sóc'}</p>
          {panel === 'primary' && <p className="text-theme-xs text-gray-500 dark:text-gray-400">Chỉ đặt được một lần; sau đó người chăm sóc chính bị khóa, không đổi hoặc gỡ được.</p>}
          {panel === 'invite' && remainingSlots === 1 && <p className="text-theme-xs text-gray-500 dark:text-gray-400">Còn đúng 1 chỗ: chọn người khác sẽ thay người đã chọn.</p>}
          <CareTeamInvitePicker
            customerId={customer.id}
            selected={selected}
            onChange={setSelected}
            maxSelectable={panel === 'primary' ? 1 : remainingSlots}
            isDisabled={isSubmitting}
            shouldAutoFocus
            pinnedOption={panel === 'primary' ? selfOption : undefined}
          />
          {errorMessage && (
            <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400">
              {errorMessage}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void submit()} disabled={selected.length === 0 || isSubmitting} className={BUTTON_PRIMARY_CLASS}>
              <Check size={16} aria-hidden="true" />
              {panel === 'primary' ? 'Đặt làm người chăm sóc chính' : selected.length > 0 ? `Mời ${selected.length} người` : 'Mời'}
            </button>
            <button type="button" onClick={() => closePanel()} disabled={isSubmitting} className="inline-flex items-center gap-1 rounded-lg p-2 text-theme-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
              <X size={16} aria-hidden="true" />
              Huỷ
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
