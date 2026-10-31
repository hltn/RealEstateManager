/**
 * Quản lý tài khoản (X7, chỉ Quản trị) qua `/users`: tạo tài khoản (email + mật khẩu + NHIỀU vai trò + NHIỀU nhóm), đổi vai trò/nhóm,
 * khóa/mở khóa. Không xóa cứng — khóa tài khoản thay vì xóa. Quyền theo vai trò cao nhất (Quản trị > Quản lý > Nhân viên); chỉ
 * Quản lý/Nhân viên mới thuộc nhóm. Backend chặn khóa/hạ quyền Quản trị cuối cùng (409 `LAST_ADMIN_REQUIRED`), tự gỡ nhóm khi mất
 * cả hai vai trò đó và tự đồng bộ phạm vi khách khi đổi nhóm/vai trò.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { useAdminUsers, useCatalogs, useCrmApi, type ApiResult } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { MultiChoiceChips, type MultiChoiceOption } from '@crm/components/form/MultiChoiceChips';
import { TextInput } from '@crm/components/form/TextInput';
import { ACCOUNT_ROLE_LABELS, ROLE_LABELS } from '@crm/lib/roles';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { AccountRole, AdminUser, Team, UserRole } from '@crm/types/crm';
import { queueRedirectNotice } from '../../../../../components/auth/RedirectWithNotice';
import { useAuth } from '../../../../../hooks/useAuth';
import { hasTeamRole, isSameSet, normalizeRoles, rolesOf, withRoles } from '../../../../../utils/userRoles';
import { buildCreateUserBody, createEmptyUserDraft, describeStepError, describeUserSaveFailure, orderUserUpdateSteps, planUserUpdate, validateNewUser, type NewUserDraft, type UserUpdateStep } from '../settingsForms';
import { SwitchRow } from './CatalogItemEditor';

const fieldId = (name: string) => `settings-user-${name}`;
const ROLE_OPTIONS: MultiChoiceOption[] = (['ADMIN', 'MANAGER', 'STAFF'] as UserRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }));
const ROLE_TONE: Record<AccountRole, string> = { ADMIN: CHIP_TONE_CLASS.error, MANAGER: CHIP_TONE_CLASS.brand, STAFF: CHIP_TONE_CLASS.gray, EDITOR: CHIP_TONE_CLASS.gray };

type EditingState = { mode: 'create'; draft: NewUserDraft; error: string | null } | { mode: 'edit'; user: AdminUser; roles: UserRole[]; teamIds: string[]; isActive: boolean; error: string | null };

type TeamRef = Pick<Team, 'id' | 'name'> & { isActive?: boolean };

/** Lựa chọn nhóm: nhóm đang hoạt động + (khi sửa) nhóm đã ngừng mà người này còn thuộc, để vẫn gỡ được. */
const buildTeamOptions = (teams: readonly TeamRef[], currentTeamIds: readonly string[]): MultiChoiceOption[] =>
  teams.filter((team) => team.isActive !== false || currentTeamIds.includes(team.id)).map((team) => ({ value: team.id, label: team.isActive === false ? `${team.name} (ngừng hoạt động)` : team.name }));

/**
 * Hệ quả khi sửa: bỏ MANAGER -> gỡ khỏi danh sách quản lý nhóm; bỏ cả MANAGER lẫn STAFF -> gỡ khỏi mọi nhóm (backend tự làm);
 * Quản trị tự bỏ ADMIN của chính mình -> mất quyền quản trị (giống cảnh báo ở màn Quản lý tài khoản).
 */
const describeRoleLossEffects = (user: AdminUser, nextRoles: readonly UserRole[], isSelf: boolean): string[] => {
  const warnings: string[] = [];
  const finalRoles = [...nextRoles, ...(user.roles.includes('EDITOR') ? ['EDITOR'] : [])];
  if (hasTeamRole(user.roles) && !hasTeamRole(finalRoles) && user.teamIds.length > 0) warnings.push('Bỏ cả Quản lý lẫn Nhân viên sẽ gỡ tài khoản này khỏi mọi nhóm (và khỏi danh sách quản lý nhóm).');
  else if (user.roles.includes('MANAGER') && !nextRoles.includes('MANAGER')) warnings.push('Bỏ vai trò Quản lý sẽ gỡ người này khỏi danh sách quản lý của các nhóm.');
  if (isSelf && user.roles.includes('ADMIN') && !nextRoles.includes('ADMIN')) warnings.push('Bạn sắp bỏ vai trò Quản trị của chính mình: sau khi lưu bạn sẽ mất quyền quản trị và được chuyển khỏi màn Cài đặt.');
  return warnings;
};

interface RoleTeamFieldsProps {
  roles: readonly UserRole[];
  teamIds: readonly string[];
  teamOptions: MultiChoiceOption[];
  /** Cảnh báo hệ quả khi bỏ vai trò (chỉ khi sửa). */
  warnings?: readonly string[];
  onRolesChange: (roles: UserRole[]) => void;
  onTeamIdsChange: (teamIds: string[]) => void;
}

/** Chọn nhiều vai trò + nhiều nhóm. Nhóm chỉ hiện khi có Quản lý/Nhân viên; không thì giải thích vì sao ẩn. */
const RoleTeamFields = ({ roles, teamIds, teamOptions, warnings = [], onRolesChange, onTeamIdsChange }: RoleTeamFieldsProps) => (
  <div className="space-y-4 sm:col-span-2">
    <MultiChoiceChips legend="Vai trò" isRequired options={ROLE_OPTIONS} values={roles} onChange={(next) => onRolesChange(next as UserRole[])} hint="Chọn được nhiều vai trò; quyền theo vai trò cao nhất (Quản trị > Quản lý > Nhân viên)." />
    {hasTeamRole(roles) ? (
      <MultiChoiceChips
        legend="Nhóm"
        isRequired
        options={teamOptions}
        values={teamIds}
        onChange={onTeamIdsChange}
        emptyMessage="Chưa có nhóm nào đang hoạt động. Tạo nhóm ở tab Nhóm trước."
        hint={roles.includes('MANAGER') ? 'Nhóm chọn đầu tiên là nhóm chính. Quản lý xem được khách của cả nhóm mình quản lý (gán làm Quản lý nhóm ở tab Nhóm).' : 'Nhóm chọn đầu tiên là nhóm chính.'}
      />
    ) : (
      <p className={MUTED_TEXT_CLASS}>Chỉ Quản lý/Nhân viên mới thuộc nhóm. Thêm một trong hai vai trò này để chọn nhóm.</p>
    )}
    {warnings.map((warning) => (
      <p key={warning} role="note" className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
        {warning}
      </p>
    ))}
  </div>
);

export const UsersSection = () => {
  const { teams } = useCatalogs();
  const { data: users, isLoading, error: loadError, refetch } = useAdminUsers();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const { user: authUser, setUser: setAuthUser } = useAuth();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const teamNameOf = (teamId: string) => teams.find((team) => team.id === teamId)?.name ?? 'Nhóm không rõ';
  const editingUserTeamIds = editing?.mode === 'edit' ? editing.user.teamIds : null;
  const teamOptions = useMemo(() => buildTeamOptions(teams, editingUserTeamIds ?? []), [teams, editingUserTeamIds]);

  const fail = (message: string) => setEditing((current) => (current ? { ...current, error: message } : current));

  const submitCreate = async (draft: NewUserDraft) => {
    const validationError = validateNewUser(draft);
    if (validationError) return fail(validationError);
    setIsSaving(true);
    const result = await api.createUser(buildCreateUserBody(draft));
    setIsSaving(false);
    if (!result.ok) return fail(result.error.message);
    showToast({ title: `Đã tạo tài khoản ${result.data.displayName}` });
    setEditing(null);
  };

  const isSelfUser = (user: AdminUser): boolean => authUser?._id === user.id;

  const runStep = (userId: string, step: UserUpdateStep): Promise<ApiResult<AdminUser>> => {
    if (step.kind === 'roles') return api.updateUserRoles(userId, step.roles);
    if (step.kind === 'teams') return api.updateUserTeams(userId, step.teamIds);
    return api.updateUserStatus(userId, step.status);
  };

  /**
   * Sửa vai trò của CHÍNH MÌNH: cập nhật phiên đăng nhập (role/roles/nhóm) theo kết quả máy chủ — giống màn Quản lý tài khoản.
   * Mất ADMIN thì `CrmLayout` tự chuyển khỏi màn Cài đặt (có thông báo) vì quyền màn theo role của phiên.
   */
  const syncOwnSession = (saved: AdminUser) => {
    if (!authUser || authUser._id !== saved.id || isSameSet(rolesOf(authUser), saved.roles)) return;
    setAuthUser({ ...withRoles(authUser, saved.roles), teamId: saved.teamId, ...(saved.roles.includes('MANAGER') ? {} : { managedTeamIds: [] }) });
  };

  /**
   * Áp từng thay đổi theo thứ tự `orderUserUpdateSteps` (vai trò -> nhóm -> trạng thái; Quản trị tự bỏ ADMIN thì `/roles` chạy cuối);
   * dừng ở lỗi đầu tiên và báo NGAY TRONG form phần đã lưu / chưa lưu. Form giữ lựa chọn đang nhập và lấy lại tài khoản mới nhất
   * từ kết quả các bước đã xong nên bấm Lưu lại chỉ chạy phần còn thiếu (idempotent). Danh sách được làm mới sau MỖI bước ghi
   * (kể cả bước lỗi) bởi lớp API nên luôn khớp CSDL.
   */
  const submitEdit = async (state: Extract<EditingState, { mode: 'edit' }>) => {
    const { user, roles, teamIds, isActive } = state;
    const planned = planUserUpdate(user, { roles, teamIds, isActive });
    if ('error' in planned) return fail(planned.error);
    const steps = orderUserUpdateSteps(user, planned.plan, isSelfUser(user));
    setIsSaving(true);
    let latest = user;
    for (const [index, step] of steps.entries()) {
      const result = await runStep(user.id, step);
      if (!result.ok) {
        const message = describeUserSaveFailure({ done: steps.slice(0, index), failed: step, pending: steps.slice(index + 1), reason: describeStepError(result.error) });
        const saved = latest;
        setIsSaving(false);
        setEditing((current) => (current?.mode === 'edit' && current.user.id === saved.id ? { ...current, user: saved, error: message } : current));
        return syncOwnSession(saved);
      }
      latest = result.data;
    }
    setIsSaving(false);
    const isLosingOwnAdmin = isSelfUser(user) && user.roles.includes('ADMIN') && !latest.roles.includes('ADMIN');
    setEditing(null);
    if (isLosingOwnAdmin) {
      // Mất ADMIN thì `CrmLayout` chuyển khỏi màn Cài đặt: chỉ hiện MỘT thông điệp thống nhất (không kèm toast lỗi "không có quyền").
      queueRedirectNotice(`Đã lưu người dùng ${user.displayName}. Bạn không còn là Quản trị nên được chuyển về màn Việc hôm nay.`);
    } else {
      showToast({ title: steps.length === 0 ? 'Không có thay đổi nào' : `Đã lưu người dùng ${user.displayName}` });
    }
    syncOwnSession(latest);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || isSaving) return;
    if (editing.mode === 'create') void submitCreate(editing.draft);
    else void submitEdit(editing);
  };

  const startEdit = (user: AdminUser) =>
    setEditing({ mode: 'edit', user, roles: user.roles.filter((role): role is UserRole => role !== 'EDITOR'), teamIds: user.teamIds, isActive: user.isActive, error: null });

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
          Tài khoản đăng nhập hệ thống. Khoá tài khoản thay vì xoá; người đang phụ trách khách cần được chuyển trước khi khoá. Một tài khoản có thể có nhiều vai trò và nhiều nhóm; Quản lý/Nhân viên cần ít nhất một nhóm.
        </p>
        {!editing && (
          <button type="button" onClick={() => setEditing({ mode: 'create', draft: createEmptyUserDraft(buildTeamOptions(teams, [])[0]?.value ?? ''), error: null })} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
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
              <RoleTeamFields
                roles={editing.draft.roles}
                teamIds={editing.draft.teamIds}
                teamOptions={teamOptions}
                onRolesChange={(roles) => setEditing({ ...editing, draft: { ...editing.draft, roles }, error: null })}
                onTeamIdsChange={(teamIds) => setEditing({ ...editing, draft: { ...editing.draft, teamIds }, error: null })}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <RoleTeamFields
                  roles={editing.roles}
                  teamIds={editing.teamIds}
                  teamOptions={teamOptions}
                  warnings={describeRoleLossEffects(editing.user, editing.roles, isSelfUser(editing.user))}
                  onRolesChange={(roles) => setEditing({ ...editing, roles, error: null })}
                  onTeamIdsChange={(teamIds) => setEditing({ ...editing, teamIds, error: null })}
                />
              </div>
              {editing.user.roles.includes('EDITOR') && <p className={MUTED_TEXT_CLASS}>Tài khoản còn vai trò Biên tập (tin tức) — giữ nguyên khi lưu; chỉnh ở màn Quản lý tài khoản.</p>}
              <div className="border-t border-gray-100 pt-3 dark:border-white/[0.05]">
                <SwitchRow label="Đang hoạt động" description={isSelfUser(editing.user) ? 'Bạn không thể tự khoá tài khoản của chính mình' : 'Tắt = khoá tài khoản; không đăng nhập và không chọn được làm người chăm sóc mới'} isDisabled={isSelfUser(editing.user)} isChecked={editing.isActive} onChange={(isActive) => setEditing({ ...editing, isActive, error: null })} />
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
                {normalizeRoles(user.roles).map((role) => (
                  <span key={role} className={`${CHIP_SMALL_CLASS} ${ROLE_TONE[role as AccountRole]}`}>
                    {ACCOUNT_ROLE_LABELS[role as AccountRole]}
                  </span>
                ))}
                {hasTeamRole(user.roles) && user.teamIds.length === 0 && <span>Chưa có nhóm</span>}
                {hasTeamRole(user.roles) &&
                  user.teamIds.map((teamId) => (
                    <span key={teamId} className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.success}`}>
                      {teamNameOf(teamId)}
                    </span>
                  ))}
                {!user.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Đã khoá</span>}
              </p>
            </div>
            <button type="button" onClick={() => startEdit(user)} className={`${BUTTON_SOFT_SM_CLASS} self-start sm:self-auto`} aria-label={`Sửa ${user.displayName}`}>
              <Pencil size={12} aria-hidden="true" />
              Sửa
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
