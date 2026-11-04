import { useState, type ReactNode } from 'react';
import { Plus, X, type LucideIcon } from 'lucide-react';
import { BRAND_SOFT_CHIP_CLASS, BUTTON_GRAY_BASE_CLASS, FORM_LABEL_CLASS } from '@crm/lib/uiClasses';
import { TextInput } from './TextInput';

interface TagInputProps {
  inputId: string;
  label: ReactNode;
  tags: readonly string[];
  onAdd: (rawValue: string) => void;
  onRemove: (tag: string) => void;
  placeholder: string;
  /** Gợi ý bấm nhanh (ẩn mục đã chọn). */
  suggestions?: readonly string[];
  suggestionLabel?: string;
  /** Danh sách tự hoàn thành của ô nhập (`<datalist>`). */
  autocompleteOptions?: readonly string[];
  /** Hiển thị tag (vd thêm '#'); giá trị lưu giữ nguyên. */
  formatTag?: (tag: string) => string;
  tagIcon?: LucideIcon;
  inputIcon?: LucideIcon;
  emptyText?: string;
  isRequired?: boolean;
  error?: ReactNode;
}

/**
 * Nhập tag + gợi ý (Admin chưa có — vẽ theo bố cục Stitch, token Admin):
 * chip đã chọn (xoá được) → ô nhập + nút "+" (Enter để thêm) → hàng gợi ý.
 * Chuỗi nháp trong ô nhập là state cục bộ; danh sách tag do form cha giữ.
 */
export const TagInput = ({
  inputId,
  label,
  tags,
  onAdd,
  onRemove,
  placeholder,
  suggestions = [],
  suggestionLabel = 'Gợi ý:',
  autocompleteOptions,
  formatTag = (tag) => tag,
  tagIcon: TagIcon,
  inputIcon,
  emptyText = 'Chưa có mục nào.',
  isRequired = false,
  error,
}: TagInputProps) => {
  const [draft, setDraft] = useState('');
  const listId = autocompleteOptions ? `${inputId}-options` : undefined;
  const lowerTags = tags.map((tag) => tag.toLowerCase());
  // Gợi ý và tag cùng dạng lưu (không '#'), so sánh không phân biệt hoa thường.
  const visibleSuggestions = suggestions.filter((item) => !lowerTags.includes(item.toLowerCase()));

  const commitDraft = () => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft('');
  };

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className={FORM_LABEL_CLASS}>
        {label}
        {isRequired && <span className="ml-0.5 text-error-500">*</span>}
      </label>

      <ul className="mb-3 flex flex-wrap gap-2" aria-label="Đã chọn">
        {tags.length === 0 && <li className="text-theme-sm text-gray-400 dark:text-gray-500">{emptyText}</li>}
        {tags.map((tag) => (
          <li key={tag} className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-sm font-medium ${BRAND_SOFT_CHIP_CLASS}`}>
            {TagIcon && <TagIcon size={14} aria-hidden="true" />}
            <span>{formatTag(tag)}</span>
            <button
              type="button"
              onClick={() => onRemove(tag)}
              aria-label={`Xóa ${formatTag(tag)}`}
              className="rounded-full p-0.5 transition-colors hover:bg-brand-100 dark:hover:bg-brand-500/25"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <TextInput
          id={inputId}
          icon={inputIcon}
          value={draft}
          list={listId}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Enter thêm tag, không submit form.
              event.preventDefault();
              commitDraft();
            }
          }}
          placeholder={placeholder}
          wrapperClassName="flex-1 min-w-0"
        />
        <button type="button" onClick={commitDraft} aria-label="Thêm" className={`${BUTTON_GRAY_BASE_CLASS} h-11 w-11 shrink-0 px-0`}>
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      {listId && autocompleteOptions && (
        <datalist id={listId}>
          {autocompleteOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
      {error}

      {visibleSuggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400">{suggestionLabel}</span>
          {visibleSuggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onAdd(item)}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500/25 dark:hover:bg-brand-500/15 dark:hover:text-brand-400"
            >
              <Plus size={12} aria-hidden="true" />
              {formatTag(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
