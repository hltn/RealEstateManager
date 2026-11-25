/**
 * Nhóm thẻ khách (FR-48, tài liệu 04 mục 3.3): Sở thích, Nghề nghiệp, Khác (`OTHER`). NGUỒN DUY NHẤT thứ tự và nhãn nhóm
 * cho form chân dung, bộ lọc, gắn hàng loạt và màn quản lý thẻ. Hàm thuần.
 */
import type { TagCategory } from '@crm/types/crm';

/** Thứ tự hiển thị các nhóm (Khác luôn cuối). */
export const TAG_CATEGORY_ORDER: readonly TagCategory[] = ['INTEREST', 'OCCUPATION', 'OTHER'];

/** Nhãn ngắn của nhóm (cột "Nhóm" và chip ở màn quản lý thẻ). */
export const TAG_CATEGORY_LABELS: Record<TagCategory, string> = { INTEREST: 'Sở thích', OCCUPATION: 'Nghề nghiệp', OTHER: 'Khác' };

/** Tiêu đề nhóm khi gom thẻ (form chân dung, bộ lọc, gắn hàng loạt). */
export const TAG_GROUP_TITLES: Record<TagCategory, string> = { INTEREST: 'Thẻ sở thích', OCCUPATION: 'Thẻ nghề nghiệp', OTHER: 'Thẻ khác' };

/**
 * Thẻ có thuộc nhóm `category` không. Nhóm lạ (máy chủ thêm nhóm mới mà FE chưa biết) tính vào "Khác" để thẻ không biến mất;
 * dùng chung cho `groupTagsByCategory` và ô chọn thẻ ở form chân dung nên hai nơi không lệch nhau.
 */
export const isTagInCategory = (tag: { category: TagCategory }, category: TagCategory): boolean =>
  TAG_CATEGORY_ORDER.includes(tag.category) ? tag.category === category : category === 'OTHER';

export interface TagGroup<T> {
  category: TagCategory;
  title: string;
  tags: T[];
}

/**
 * Gom thẻ theo nhóm theo `TAG_CATEGORY_ORDER`, BỎ nhóm rỗng. Thẻ có nhóm lạ (máy chủ thêm nhóm mới mà FE chưa biết)
 * được xếp vào "Khác" thay vì biến mất khỏi bộ lọc/gắn hàng loạt.
 */
export const groupTagsByCategory = <T extends { category: TagCategory }>(tags: readonly T[]): TagGroup<T>[] => {
  return TAG_CATEGORY_ORDER.map((category) => ({
    category,
    title: TAG_GROUP_TITLES[category],
    tags: tags.filter((tag) => isTagInCategory(tag, category)),
  })).filter((group) => group.tags.length > 0);
};
