import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { useVisibleListMaxHeight } from '@crm/hooks/useVisibleListMaxHeight';
import { CHIP_CLASS, CHIP_TONE_CLASS, FORM_LABEL_CLASS, INPUT_ICON_CLASS, getInputClass } from '@crm/lib/uiClasses';
import { filterOptionsByKeyword } from './searchMatch';
import type { SelectOption } from './SelectInput';

interface SearchableMultiSelectProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onToggle' | 'type' | 'role' | 'children'> {
  /** Bắt buộc: `<label for>` trỏ vào ô tìm kiếm; id danh sách/lựa chọn suy ra từ đây. */
  id: string;
  legend: ReactNode;
  options: readonly SelectOption[];
  /** Giá trị đang chọn, GIỮ THỨ TỰ chọn (chip hiện theo thứ tự này). */
  selected: readonly string[];
  /** Bật/tắt 1 giá trị (cùng chữ ký với `ChipMultiSelect.onToggle`, nên dùng lại hàm `toggleProject` sẵn có). */
  onToggle: (value: string) => void;
  icon?: LucideIcon;
  /** Tên truy cập của danh sách (trình đọc màn hình), vd "Danh sách dự án". */
  listLabel?: string;
  /** Chữ khi lọc không ra kết quả / khi không có lựa chọn nào. */
  emptyMessage?: string;
  isRequired?: boolean;
}

/**
 * Selectbox CHỌN NHIỀU có ô tìm kiếm tích hợp (combobox WAI-ARIA, `aria-multiselectable`): gõ để lọc theo nhãn, ưu tiên không dấu
 * ("q terra", "thao dien" khớp "Thảo Điền"). Chọn xong danh sách vẫn mở để chọn tiếp; mục đã chọn hiện thành chip bên dưới, bấm X để bỏ.
 * Dùng chung cho chọn "Dự án quan tâm" (PT-019: tạo khách, sửa thông tin khách).
 *
 * Mobile (iOS Safari): ô tìm kiếm dùng chữ 16px để Safari KHÔNG tự phóng to trang khi focus; chiều cao danh sách tính theo `visualViewport`
 * (phần không bị bàn phím ảo che) và ô được cuộn lên đầu vùng nhìn thấy nếu chỗ trống quá thấp — xem `useVisibleListMaxHeight`.
 */
export const SearchableMultiSelect = ({
  id,
  legend,
  options,
  selected,
  onToggle,
  icon: Icon,
  listLabel = 'Danh sách lựa chọn',
  emptyMessage = 'Không tìm thấy kết quả phù hợp.',
  isRequired = false,
  placeholder = 'Gõ để tìm…',
  className,
  disabled,
  ...inputProps
}: SearchableMultiSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listMaxHeight = useVisibleListMaxHeight(isOpen, inputRef, rootRef);

  const listboxId = `${id}-listbox`;
  const getOptionId = (index: number) => `${id}-option-${index}`;
  const items = useMemo(() => filterOptionsByKeyword(options, query), [options, query]);
  const selectedOptions = selected.flatMap((value) => options.find((option) => option.value === value) ?? []);

  // Dùng mũi tên: cuộn danh sách để dòng đang tô sáng luôn nằm trong vùng nhìn thấy (danh sách dự án dài). Rê chuột thì KHÔNG cuộn (tránh giật).
  const shouldScrollToActiveRef = useRef(false);
  useEffect(() => {
    if (!isOpen || !shouldScrollToActiveRef.current) return;
    shouldScrollToActiveRef.current = false;
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, activeIndex, isOpen]);

  const open = () => {
    if (!isOpen && !disabled) setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  /** Bật/tắt 1 mục; giữ danh sách mở và xoá từ khoá để tìm tiếp mục khác. */
  const toggle = (item: SelectOption) => {
    onToggle(item.value);
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) open();
        else {
          shouldScrollToActiveRef.current = true;
          setActiveIndex((index) => Math.max(0, Math.min(index + 1, items.length - 1)));
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) open();
        else {
          shouldScrollToActiveRef.current = true;
          setActiveIndex((index) => Math.max(index - 1, 0));
        }
        break;
      case 'Enter':
        // Không để Enter gửi form khi đang chọn trong danh sách.
        if (isOpen) {
          event.preventDefault();
          if (items[activeIndex]) toggle(items[activeIndex]);
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          close();
        }
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className="min-w-0 scroll-mt-24"
      onBlur={(event) => {
        // Focus chuyển ra ngoài cả khối (ô nhập, danh sách, chip) thì đóng danh sách.
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <label htmlFor={id} className={FORM_LABEL_CLASS}>
        {legend}
        {isRequired && <span className="ml-0.5 text-error-500">*</span>}
      </label>
      <div className="relative">
        {Icon && <Icon size={18} aria-hidden="true" className={INPUT_ICON_CLASS} />}
        <input
          {...inputProps}
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={isOpen && items[activeIndex] ? getOptionId(activeIndex) : undefined}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={open}
          onClick={open}
          onKeyDown={handleKeyDown}
          // `text-base md:text-sm`: 16px trên điện thoại, tránh iOS Safari tự phóng to khi focus ô nhập chữ < 16px.
          className={twMerge(getInputClass({ hasLeftIcon: Boolean(Icon), hasRightAddon: true }), 'text-base md:text-sm', className)}
        />
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        {isOpen && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={listLabel}
            aria-multiselectable="true"
            // Không nhận focus bàn phím và bấm thanh cuộn/đệm không làm ô nhập mất focus (đóng danh sách).
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
            className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-1 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {items.length === 0 && <li className="px-3 py-2 text-theme-xs text-gray-500 dark:text-gray-400">{options.length === 0 ? 'Chưa có lựa chọn nào.' : emptyMessage}</li>}
            {items.map((item, index) => {
              const isSelected = selected.includes(item.value);
              return (
                <li
                  key={item.value}
                  id={getOptionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  // mousedown (không phải click) để chọn trước khi ô nhập mất focus; touch trên iOS cũng phát mousedown tổng hợp.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    toggle(item);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-gray-800 dark:text-white/90 ${
                    index === activeIndex ? 'bg-brand-50 dark:bg-brand-500/15' : ''
                  } ${isSelected ? 'font-semibold' : ''}`}
                >
                  <span className="min-w-0">{item.label}</span>
                  {isSelected && <Check size={16} aria-hidden="true" className="shrink-0 text-brand-500" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedOptions.length > 0 && (
        <ul aria-label="Đã chọn" className="mt-2 flex flex-wrap gap-2">
          {selectedOptions.map((option) => (
            <li key={option.value} className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand} gap-1`}>
              {option.label}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(option.value)}
                aria-label={`Bỏ chọn ${option.label}`}
                className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
