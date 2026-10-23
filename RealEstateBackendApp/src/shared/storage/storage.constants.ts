/** S3Client dùng để gọi API (đọc/ghi/xóa) qua endpoint nội bộ. */
export const S3_CLIENT = Symbol('S3_CLIENT');
/** S3Client chỉ dùng để ký presigned URL (endpoint công khai nếu khác endpoint nội bộ). */
export const S3_PRESIGN_CLIENT = Symbol('S3_PRESIGN_CLIENT');
