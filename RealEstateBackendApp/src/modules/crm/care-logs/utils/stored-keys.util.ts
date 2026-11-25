/**
 * Khóa các file thật trong kho của một ảnh đính kèm: file gốc và (nếu đã có) thumbnail (FR-26). Dùng khi xóa/dọn/purge
 * để không bỏ sót thumbnail mồ côi.
 */
export const storedKeysOf = (row: {
  fileKey: string;
  thumbKey?: string | null;
}): string[] => (row.thumbKey ? [row.fileKey, row.thumbKey] : [row.fileKey]);
