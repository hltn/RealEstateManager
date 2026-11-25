/**
 * Bộ chọn người để mời vào nhóm chăm sóc (v1.0.5, FR-13, 14): ô tìm có debounce, danh sách phân trang "tên · nhóm", chọn nhiều (hoặc một).
 * Nguồn `GET /crm/care-team-invitees` qua `useCareTeamInvitees`: chỉ có id, tên hiển thị, tên nhóm — KHÔNG email/SĐT/vai trò.
 * Có `customerId`: loại người đã trong nhóm của khách đó (mời ở hồ sơ khách). Không có: danh sách cho thao tác hàng loạt (Quản trị/Quản lý).
 * Hộp chỉ được mount khi đang mở, nên truy vấn chỉ chạy khi người dùng thực sự mở hộp mời.
 */
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useCareTeamInvitees } from '@crm/api';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { BUTTON_OUTLINE_BASE_CLASS, CHECKBOX_CLASS, MUTED_TEXT_CLASS, SOLID_INPUT_CLASS } from '@crm/lib/uiClasses';

/** Từ khóa tìm tối đa 50 ký tự (khớp hợp đồng `care-team-invitees`). */
const SEARCH_MAX_LENGTH = 50;
const SEARCH_DEBOUNCE_MS = 250;
const NO_TEAM_LABEL = 'chưa có nhóm';

interface CareTeamInvitePickerProps {
  /** Có: chỉ người chưa thuộc nhóm của khách này. Không có: danh sách cho thao tác hàng loạt. */
  customerId?: string;
  selectedIds: readonly string[];
  onSelectedChange: (ids: string[]) => void;
  /** `multiple` (mặc định): chọn nhiều; `single`: chọn đúng một người (đặt người chăm sóc chính). */
  selectionMode?: 'multiple' | 'single';
  /** Số người được chọn tối đa ở chế độ `multiple` (vd số chỗ còn lại của giới hạn 10 thành viên phụ). */
  maxSelectable?: number;
  /** Tiền tố id cho ô tìm/danh sách (nhiều bộ chọn cùng màn hình). */
  idPrefix?: string;
  /** Lựa chọn ghim đầu danh sách, không qua tìm kiếm/phân trang (vd "Chính tôi" khi đặt người chăm sóc chính; `GET care-team-invitees` loại chính người gọi). */
  pinnedOption?: { id: string; label: string };
}

/** Một dòng lựa chọn (checkbox hoặc radio) — dùng chung cho lựa chọn ghim và từng người trong danh sách. */
interface OptionRowProps {
  label: string;
  inputName: string;
  inputType: 'checkbox' | 'radio';
  isSelected: boolean;
  isBlocked: boolean;
  onToggle: () => void;
}

const OptionRow = ({ label, inputName, inputType, isSelected, isBlocked, onToggle }: OptionRowProps) => (
  <li>
    <label className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-theme-sm ${isBlocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5'}`}>
      <input type={inputType} name={inputName} checked={isSelected} disabled={isBlocked} onChange={onToggle} className={CHECKBOX_CLASS} />
      <span className="min-w-0 truncate text-gray-800 dark:text-white/90">{label}</span>
    </label>
  </li>
);

export const CareTeamInvitePicker = ({ customerId, selectedIds, onSelectedChange, selectionMode = 'multiple', maxSelectable, idPrefix = 'invite', pinnedOption }: CareTeamInvitePickerProps) => {
  const [keyword, setKeyword] = useState('');
  // Trang gắn với từ khóa (đã debounce) lúc chọn: đổi từ khóa thì tự về trang 1 mà không cần setState thừa trước debounce (tránh truy vấn "từ khóa cũ, trang 1").
  const [pageState, setPageState] = useState({ keyword: '', page: 1 });
  // Tên người đã chọn (ghi khi bấm chọn) để dòng "Đã chọn: ..." vẫn đủ tên khi họ không còn ở trang/từ khóa hiện tại.
  const [namesById, setNamesById] = useState<Record<string, string>>({});
  const debouncedKeyword = useDebouncedValue(keyword.trim(), SEARCH_DEBOUNCE_MS);
  const page = pageState.keyword === debouncedKeyword ? pageState.page : 1;
  const { data: invitees } = useCareTeamInvitees(customerId, debouncedKeyword, page);

  const isSingle = selectionMode === 'single';
  const isLimitReached = !isSingle && maxSelectable !== undefined && selectedIds.length >= maxSelectable;
  const { totalPages, total } = invitees.meta;

  const toggle = (id: string, displayName: string) => {
    setNamesById((current) => ({ ...current, [id]: displayName }));
    if (isSingle) onSelectedChange([id]);
    else onSelectedChange(selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id]);
  };
  const nameOf = (id: string) => (pinnedOption?.id === id ? pinnedOption.label : (namesById[id] ?? id));
  const goToPage = (nextPage: number) => setPageState({ keyword: debouncedKeyword, page: nextPage });
  const inputType = isSingle ? 'radio' : 'checkbox';
  const inputName = `${idPrefix}-option`;

  const searchId = `${idPrefix}-search`;
  return (
    <div className="space-y-3">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Tìm người để mời
        </label>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          maxLength={SEARCH_MAX_LENGTH}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="Tìm theo tên"
          className={`${SOLID_INPUT_CLASS} pl-9`}
        />
      </div>

      <ul aria-label="Danh sách người có thể mời" className="max-h-56 space-y-1 overflow-y-auto">
        {pinnedOption && (
          <OptionRow
            label={pinnedOption.label}
            inputName={inputName}
            inputType={inputType}
            isSelected={selectedIds.includes(pinnedOption.id)}
            isBlocked={!selectedIds.includes(pinnedOption.id) && isLimitReached}
            onToggle={() => toggle(pinnedOption.id, pinnedOption.label)}
          />
        )}
        {invitees.data.length === 0 && <li className={`${MUTED_TEXT_CLASS} px-1 py-2`}>Không tìm thấy người phù hợp.</li>}
        {invitees.data.map((invitee) => (
          <OptionRow
            key={invitee.id}
            label={`${invitee.displayName} · ${invitee.teamNames.length > 0 ? invitee.teamNames.join(', ') : NO_TEAM_LABEL}`}
            inputName={inputName}
            inputType={inputType}
            isSelected={selectedIds.includes(invitee.id)}
            isBlocked={!selectedIds.includes(invitee.id) && isLimitReached}
            onToggle={() => toggle(invitee.id, invitee.displayName)}
          />
        ))}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="Phân trang danh sách người mời" className="flex items-center justify-between gap-2">
          <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)} className={`${BUTTON_OUTLINE_BASE_CLASS} h-8 px-3 text-xs`}>
            Trang trước
          </button>
          <span className={MUTED_TEXT_CLASS}>
            Trang {invitees.meta.page}/{totalPages} · {total} người
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)} className={`${BUTTON_OUTLINE_BASE_CLASS} h-8 px-3 text-xs`}>
            Trang sau
          </button>
        </nav>
      )}

      <p className={MUTED_TEXT_CLASS} aria-live="polite">
        {selectedIds.length === 0 ? 'Chưa chọn ai.' : `Đã chọn ${selectedIds.length}: ${selectedIds.map(nameOf).join(', ')}`}
        {isLimitReached && ` (tối đa ${maxSelectable})`}
      </p>
    </div>
  );
};
