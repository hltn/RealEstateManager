/**
 * Dọn bộ lọc thẻ "mồ côi": khi danh sách thẻ nạp lại, gỡ khỏi `filters.tagIds` các id không còn tồn tại
 * (thẻ bị admin khác xóa/gộp) để danh sách khách không rỗng vô cớ và chip còn chỗ để bỏ chọn.
 * `existingTagIds` phải là id thẻ THẬT từ server (`useCatalogs().existingTagIds`); `null` = chưa tải xong hoặc đang lỗi
 * thì KHÔNG dọn gì (danh sách rỗng do chưa tải không được phép xóa bộ lọc).
 */
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useCrmActions, useCrmStore } from '@crm/store';

export const usePruneStaleTagFilters = (existingTagIds: readonly string[] | null): void => {
  const { pruneStaleTagFilters } = useCrmActions();
  // Selector hẹp: chỉ render lại khi `filters.tagIds` đổi, không theo mọi thay đổi của state CRM.
  const tagIds = useStore(useCrmStore(), (shape) => shape.state.filters.tagIds);
  const hasSelectedTags = tagIds.length > 0;

  useEffect(() => {
    if (existingTagIds === null || !hasSelectedTags) return;
    pruneStaleTagFilters([...existingTagIds]);
  }, [existingTagIds, hasSelectedTags, tagIds, pruneStaleTagFilters]);
};
