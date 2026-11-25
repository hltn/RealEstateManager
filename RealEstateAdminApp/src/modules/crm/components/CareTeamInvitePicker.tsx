/**
 * Chọn người để mời vào nhóm chăm sóc (FR-14): ô tìm có debounce, danh sách phân trang "tên · nhóm", chọn nhiều.
 * Chỉ hiện tên và tên nhóm (không email/SĐT). Có `customerId` = mời vào khách đó (server loại người đã trong nhóm); bỏ trống = hàng loạt.
 * Chỉ MOUNT khi người dùng mở khung mời: truy vấn `care-team-invitees` (giới hạn 60 lượt/phút) không chạy lúc mở hồ sơ.
 * Đã chọn giữ qua các trang/ô tìm; `maxSelectable` = 1 là chế độ CHỌN MỘT (radio): chọn người khác sẽ thay người đã chọn.
 * `pinnedOption`: một lựa chọn cố định đặt trên cùng, không phụ thuộc ô tìm/trang (vd "Chính tôi" khi Quản trị/Quản lý đặt người chăm sóc chính;
 * server không trả chính người gọi trong danh sách mời).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useCareTeamInvitees, type CareTeamInvitee } from '@crm/api';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { MUTED_TEXT_CLASS, NAV_ICON_BUTTON_CLASS, SOLID_INPUT_CLASS } from '@crm/lib/uiClasses';

/** Khớp giới hạn `q` của endpoint. */
const SEARCH_MAX_LENGTH = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface CareTeamInvitePickerProps {
  /** Khách được mời vào; bỏ trống = thao tác hàng loạt (chỉ Quản trị/Quản lý). */
  customerId?: string;
  selected: CareTeamInvitee[];
  onChange: (selected: CareTeamInvitee[]) => void;
  /** Số người tối đa được chọn (còn trống trong nhóm); đủ rồi thì các ô còn lại bị vô hiệu. */
  maxSelectable: number;
  isDisabled?: boolean;
  /** Đưa focus vào ô tìm khi mở (khung mời mở theo thao tác của người dùng). Mặc định không, tránh giành focus của ô chọn hành động. */
  shouldAutoFocus?: boolean;
  pinnedOption?: CareTeamInvitee;
}

const formatInviteeLabel = (invitee: CareTeamInvitee): string => (invitee.teamNames.length > 0 ? `${invitee.displayName} · ${invitee.teamNames.join(', ')}` : invitee.displayName);

export const CareTeamInvitePicker = ({ customerId, selected, onChange, maxSelectable, isDisabled = false, shouldAutoFocus = false, pinnedOption }: CareTeamInvitePickerProps) => {
  const groupName = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  // Trang gắn với từ khoá đã debounce: đổi từ khoá thì về trang 1 NGAY (cả khi quay lại từ khoá cũ, không giữ trang cũ).
  const [pageState, setPageState] = useState({ q: '', page: 1 });
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  if (pageState.q !== q) setPageState({ q, page: 1 });
  const page = pageState.q === q ? pageState.page : 1;
  const { data, isLoading, isFetching, isError, refetch } = useCareTeamInvitees(customerId, q, page);

  useEffect(() => {
    if (shouldAutoFocus) searchRef.current?.focus();
  }, [shouldAutoFocus]);

  const selectedIds = new Set(selected.map((invitee) => invitee.id));
  const isSingle = maxSelectable === 1;
  const isFull = selected.length >= maxSelectable;
  const { totalPages } = data.meta;

  const toggle = (invitee: CareTeamInvitee) => {
    if (selectedIds.has(invitee.id)) onChange(selected.filter((item) => item.id !== invitee.id));
    else if (isSingle) onChange([invitee]);
    else if (!isFull) onChange([...selected, invitee]);
  };

  // Chế độ chọn một dùng radio (một nhóm tên chung, thao tác bằng phím mũi tên); chọn nhiều dùng checkbox, đủ hạn mức thì khóa ô chưa chọn.
  const renderRow = (invitee: CareTeamInvitee) => {
    const isSelected = selectedIds.has(invitee.id);
    const isBlocked = isDisabled || (!isSelected && isFull && !isSingle);
    return (
      <li key={invitee.id}>
        <label className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-theme-sm text-gray-800 hover:bg-gray-50 dark:text-white/90 dark:hover:bg-white/5 ${isBlocked ? 'cursor-not-allowed opacity-50' : ''}`}>
          <input
            type={isSingle ? 'radio' : 'checkbox'}
            name={isSingle ? groupName : undefined}
            checked={isSelected}
            disabled={isBlocked}
            onChange={() => toggle(invitee)}
            className="h-4 w-4 shrink-0 border-gray-300 accent-brand-500"
          />
          <span className="min-w-0 truncate">{formatInviteeLabel(invitee)}</span>
        </label>
      </li>
    );
  };

  return (
    <div role={isSingle ? 'radiogroup' : 'group'} aria-label={isSingle ? 'Chọn một người' : 'Chọn người để mời'} className="space-y-2">
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={searchRef}
          type="search"
          value={search}
          maxLength={SEARCH_MAX_LENGTH}
          disabled={isDisabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên…"
          aria-label="Tìm người để mời"
          className={`${SOLID_INPUT_CLASS} pl-9`}
        />
      </div>

      {selected.length > 0 && (
        <ul aria-label="Người đã chọn" className="flex flex-wrap gap-1.5">
          {selected.map((invitee) => (
            <li key={invitee.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
              {invitee.displayName}
              <button type="button" disabled={isDisabled} onClick={() => toggle(invitee)} aria-label={`Bỏ chọn ${invitee.displayName}`} className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-500/25">
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pinnedOption && (
        <ul aria-label="Chọn nhanh" className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          {renderRow(pinnedOption)}
        </ul>
      )}

      {isLoading ? (
        <p role="status" className={MUTED_TEXT_CLASS}>
          Đang tải danh sách…
        </p>
      ) : isError ? (
        <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400">
          Không tải được danh sách người.{' '}
          <button type="button" onClick={refetch} className="font-medium underline">
            Thử lại
          </button>
        </p>
      ) : data.data.length === 0 ? (
        <p className={MUTED_TEXT_CLASS}>{q ? 'Không tìm thấy người phù hợp.' : 'Không còn người nào để mời.'}</p>
      ) : (
        <ul aria-label="Danh sách người có thể mời" aria-busy={isFetching} className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-white/[0.05] dark:border-gray-700">
          {data.data.map((invitee) => renderRow(invitee))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPageState({ q, page: page - 1 })} className={`${NAV_ICON_BUTTON_CLASS} disabled:opacity-40`}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="text-theme-xs text-gray-500 dark:text-gray-400">
            Trang {page}/{totalPages}
          </span>
          <button type="button" aria-label="Trang sau" disabled={page >= totalPages} onClick={() => setPageState({ q, page: page + 1 })} className={`${NAV_ICON_BUTTON_CLASS} disabled:opacity-40`}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {isFull && !isSingle && <p className="text-theme-xs text-gray-500 dark:text-gray-400">Đã chọn tối đa {maxSelectable} người.</p>}
    </div>
  );
};
