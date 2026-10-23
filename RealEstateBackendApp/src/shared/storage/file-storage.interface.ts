import type { FileValidationPolicy } from './file-validation';

/** Injection token của lớp lưu trữ file (inject interface để dễ mock khi test). */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Bucket logic; tên bucket thật lấy từ cấu hình (S3_BUCKET_ATTACHMENTS / S3_BUCKET_EXPORTS). */
export enum StorageBucket {
  ATTACHMENTS = 'ATTACHMENTS',
  EXPORTS = 'EXPORTS',
}

export interface UploadFileInput {
  bucket: StorageBucket;
  body: Buffer;
  mimeType: string;
  policy: FileValidationPolicy;
  /** Thư mục logic, ví dụ `customers/<id>/`. Phải kết thúc bằng `/` nếu có. */
  prefix?: string;
}

export interface StoredFile {
  bucket: StorageBucket;
  /** Khóa object: `<prefix><uuid>.<ext>` — tên gốc của client không bao giờ được dùng. */
  key: string;
  size: number;
  mimeType: string;
}

export interface CreatePresignedUploadInput {
  bucket: StorageBucket;
  mimeType: string;
  /** Dung lượng chính xác client sẽ gửi — được ký vào URL nên S3 từ chối nếu khác. */
  size: number;
  policy: FileValidationPolicy;
  prefix?: string;
}

export interface PresignedUpload {
  url: string;
  key: string;
  expiresInSeconds: number;
  /** Header client BẮT BUỘC gửi kèm PUT (đã được ký). */
  headers: Record<string, string>;
}

export interface PresignedDownloadOptions {
  expiresInSeconds?: number;
  /** Tên file gợi ý khi tải về (Content-Disposition: attachment). */
  downloadFileName?: string;
}

export interface IFileStorage {
  /** Kiểm tra (MIME, dung lượng, magic bytes) rồi tải lên với tên UUID. */
  upload(input: UploadFileInput): Promise<StoredFile>;
  /**
   * Cấp URL PUT có chữ ký để client tải thẳng lên S3. Chỉ kiểm được MIME + dung lượng khai báo,
   * KHÔNG kiểm được magic bytes — nghiệp vụ cần chắc chắn phải kiểm lại nội dung sau khi upload.
   */
  createPresignedUpload(
    input: CreatePresignedUploadInput,
  ): Promise<PresignedUpload>;
  getPresignedDownloadUrl(
    bucket: StorageBucket,
    key: string,
    options?: PresignedDownloadOptions,
  ): Promise<string>;
  download(bucket: StorageBucket, key: string): Promise<Buffer>;
  /** Xóa object (idempotent: key không tồn tại vẫn thành công). */
  delete(bucket: StorageBucket, key: string): Promise<void>;
  /** Kiểm tra kết nối tới mọi bucket đã cấu hình; ném lỗi nếu không với tới được. */
  checkHealth(): Promise<void>;
  /** Đã cấu hình ít nhất một bucket hay chưa. */
  isConfigured(): boolean;
}
