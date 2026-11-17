import { normalizeVietnamese } from '@crm/lib/text';
import type { SelectOption } from './SelectInput';

/** Độ khớp của 1 nhãn với từ khoá (đã bỏ dấu): 0 = bắt đầu bằng từ khoá, 1 = đầu một từ, 2 = chỉ chứa; null = không khớp. */
export const getMatchRank = (terms: readonly string[], keyword: string): number | null => {
  let best: number | null = null;
  for (const term of terms) {
    const text = normalizeVietnamese(term);
    const index = text.indexOf(keyword);
    if (index < 0) continue;
    const rank = index === 0 ? 0 : text[index - 1] === ' ' ? 1 : 2;
    if (best === null || rank < best) best = rank;
  }
  return best;
};

/**
 * Lọc + xếp lựa chọn theo từ khoá không dấu ("ha noi" khớp "Hà Nội"): mục bắt đầu bằng từ khoá lên trước, rồi mục có từ bắt đầu bằng từ khoá,
 * rồi mục chỉ chứa; sắp ổn định (giữ thứ tự gốc trong cùng nhóm). Từ khoá rỗng -> giữ nguyên danh sách.
 */
export const filterOptionsByKeyword = (options: readonly SelectOption[], query: string, getSearchTerms: (label: string) => readonly string[] = (label) => [label]): SelectOption[] => {
  const keyword = normalizeVietnamese(query);
  if (!keyword) return [...options];
  return options
    .map((option) => ({ option, rank: getMatchRank(getSearchTerms(option.label), keyword) }))
    .filter((entry): entry is { option: SelectOption; rank: number } => entry.rank !== null)
    .sort((first, second) => first.rank - second.rank)
    .map((entry) => entry.option);
};
