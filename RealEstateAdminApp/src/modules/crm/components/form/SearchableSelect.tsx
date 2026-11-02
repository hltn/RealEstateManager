import { useEffect, useMemo, useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { INPUT_ICON_CLASS, getInputClass } from '@crm/lib/uiClasses';
import { filterOptionsByKeyword } from './searchMatch';
import type { SelectOption } from './SelectInput';

interface SearchableSelectProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'role' | 'children'> {
  /** Bắt buộc: `<label for>` của FormField trỏ vào ô nhập này. */
  id: string;
  options: readonly SelectOption[];
  /** Giá trị đang chọn; '' = chưa chọn. */
  value: string;
  onChange: (value: string) => void;
  icon?: LucideIcon;
  hasError?: boolean;
  /** Thêm lựa chọn "bỏ chọn" (giá trị '') đứng đầu danh sách khi chưa gõ từ khoá; cũng là chữ gợi ý khi chưa chọn gì. */
  emptyLabel?: string;
  /** Tên truy cập của danh sách (đọc bởi trình đọc màn hình), vd "Danh sách khu vực". */
  listLabel?: string;
  /** Chuỗi dùng để tìm cho 1 nhãn (đã/chưa bỏ dấu đều được); mặc định chỉ tìm theo nhãn. Dùng để thêm bí danh ("hcm" -> TP. Hồ Chí Minh). */
  getSearchTerms?: (label: string) => readonly string[];
}

const defaultSearchTerms = (label: string): readonly string[] => [label];

/** Danh sách chọn có ô tìm kiếm (combobox theo WAI-ARIA): gõ để lọc, bỏ dấu tiếng Việt ("ha noi" khớp "Hà Nội"). */
export const SearchableSelect = ({ id, options, value, onChange, icon: Icon, hasError = false, emptyLabel, listLabel = 'Danh sách lựa chọn', getSearchTerms = defaultSearchTerms, placeholder, className, disabled, ...inputProps }: SearchableSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  /** Từ khoá đang gõ; chưa gõ thì ô hiển thị nhãn của lựa chọn hiện tại. */
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';
  const listboxId = `${id}-listbox`;
  const getOptionId = (index: number) => `${id}-option-${index}`;

  // Dòng "bỏ chọn" chỉ hiện khi chưa gõ từ khoá. Có từ khoá: lọc không dấu, mục bắt đầu bằng từ khoá lên trước, rồi mục có từ bắt đầu bằng từ khoá (sắp ổn định, giữ thứ tự gốc trong cùng nhóm).
  const items = useMemo<SelectOption[]>(() => {
    if (!query.trim()) return emptyLabel !== undefined ? [{ value: '', label: emptyLabel }, ...options] : [...options];
    return filterOptionsByKeyword(options, query, getSearchTerms);
  }, [options, query, emptyLabel, getSearchTerms]);

  const open = () => {
    if (isOpen || disabled) return;
    setIsOpen(true);
    const selectedIndex = items.findIndex((item) => item.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const select = (item: SelectOption) => {
    onChange(item.value);
    close();
  };

  // Giữ dòng đang tô sáng (bàn phím) trong vùng nhìn thấy của danh sách.
  useEffect(() => {
    if (isOpen) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, activeIndex, isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) open();
        else setActiveIndex((index) => Math.min(index + 1, items.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) open();
        else setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Enter':
        // Không để Enter gửi form khi đang chọn trong danh sách.
        if (isOpen) {
          event.preventDefault();
          if (items[activeIndex]) select(items[activeIndex]);
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          close();
        }
        break;
      default:
        // Đang đóng và có nhãn đã chọn trong ô: bôi đen để ký tự gõ vào THAY nhãn thay vì nối vào đuôi ("Hà Nộix").
        if (!isOpen && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) event.currentTarget.select();
    }
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // Chuyển focus sang phần tử khác ngoài ô này thì đóng danh sách.
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      {Icon && <Icon size={18} aria-hidden="true" className={INPUT_ICON_CLASS} />}
      <input
        {...inputProps}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && items[activeIndex] ? getOptionId(activeIndex) : undefined}
        aria-invalid={hasError || undefined}
        disabled={disabled}
        value={isOpen ? query : selectedLabel}
        placeholder={placeholder ?? emptyLabel}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onFocus={open}
        onClick={open}
        onKeyDown={handleKeyDown}
        className={`${getInputClass({ hasError, hasLeftIcon: Boolean(Icon), hasRightAddon: true })} ${className ?? ''}`}
      />
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={listLabel}
          // Không nhận focus bàn phím (Tab đi tiếp ra khỏi ô) và bấm thanh cuộn/đệm không làm ô nhập mất focus (đóng danh sách).
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {items.length === 0 && <li className="px-3 py-2 text-theme-xs text-gray-500 dark:text-gray-400">Không tìm thấy kết quả phù hợp.</li>}
          {items.map((item, index) => (
            <li
              key={item.value || '__empty'}
              id={getOptionId(index)}
              role="option"
              aria-selected={item.value === value}
              // mousedown (không phải click) để chọn trước khi ô nhập mất focus.
              onMouseDown={(event) => {
                event.preventDefault();
                select(item);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`cursor-pointer rounded-md px-3 py-2 text-sm text-gray-800 dark:text-white/90 ${
                index === activeIndex ? 'bg-brand-50 dark:bg-brand-500/15' : ''
              } ${item.value === value ? 'font-semibold' : ''}`}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
