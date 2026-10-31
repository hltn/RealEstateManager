/**
 * Ảnh đính kèm của form "Thêm nhật ký chăm sóc" (C2): mỗi ảnh được TẢI LÊN NGAY qua `POST care-log-attachments`
 * (jpeg/png/webp, ≤ 5 MB; server kiểm magic bytes, bỏ EXIF/GPS, đổi tên UUID) và giữ lại `attachmentId` để gắn vào nhật ký khi lưu.
 * Xem trước bằng object URL cục bộ (không đọc ảnh vào bộ nhớ dưới dạng data URL). Tối đa 5 ảnh/ghi chú.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_NOTE, useCrmApi, type ApiError } from '@crm/api';

export const MAX_ATTACHED_PHOTOS = ATTACHMENT_MAX_PER_NOTE;
export const MAX_PHOTO_BYTES = ATTACHMENT_MAX_BYTES;

export type AttachedPhotoStatus = 'uploading' | 'ready' | 'error';

export interface AttachedPhoto {
  key: string;
  name: string;
  /** Object URL xem trước (cục bộ). */
  previewUrl: string;
  status: AttachedPhotoStatus;
  /** Có khi `status = 'ready'`. */
  attachmentId?: string;
  errorMessage?: string;
}

export interface AttachedPhotos {
  photos: AttachedPhoto[];
  /** Id ảnh đã tải xong (gắn vào nhật ký). */
  attachmentIds: string[];
  isUploading: boolean;
  /** Thêm ảnh từ file người dùng chọn; trả về số file bị bỏ qua (sai định dạng / quá lớn / quá số lượng). */
  addFiles: (files: FileList | File[]) => Promise<number>;
  /** Bỏ ảnh khỏi form; ảnh đã tải lên nhưng chưa gắn sẽ được xóa khỏi kho (best-effort). */
  removePhoto: (index: number) => void;
  /** Dọn form sau khi lưu nhật ký (KHÔNG xóa ảnh ở kho vì đã gắn vào nhật ký). */
  clearPhotos: () => void;
}

/** File hợp lệ: đúng MIME ảnh được phép và không vượt dung lượng. */
export const isAcceptedPhotoFile = (file: Pick<File, 'type' | 'size'>): boolean =>
  (ATTACHMENT_ACCEPT as readonly string[]).includes(file.type) && file.size > 0 && file.size <= MAX_PHOTO_BYTES;

/** Chia file chọn thành phần nhận được (theo chỗ còn trống) và số bị bỏ qua. */
export const pickAcceptedFiles = (candidates: readonly File[], freeSlots: number): { accepted: File[]; skippedCount: number } => {
  const valid = candidates.filter(isAcceptedPhotoFile);
  const accepted = valid.slice(0, Math.max(0, freeSlots));
  return { accepted, skippedCount: candidates.length - accepted.length };
};

/**
 * Lỗi tải ảnh -> câu dễ hiểu cho người dùng. 404 riêng cho tải ảnh gần như chắc chắn là backend chưa bật
 * `FEATURE_CRM_ATTACHMENTS` (hoặc khách ngoài quyền xem), nên không dùng câu chung "không tìm thấy dữ liệu".
 */
export const describeUploadError = (error: ApiError): string => {
  if (error.statusCode === 413 || error.errorCode === 'FILE_TOO_LARGE') return `Ảnh quá lớn, tối đa ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`;
  if (error.statusCode === 415 || error.errorCode === 'ATTACHMENT_TYPE_INVALID') return 'Chỉ nhận ảnh JPEG, PNG hoặc WebP hợp lệ.';
  if (error.statusCode === 404) return 'Máy chủ chưa bật tính năng tải ảnh (hoặc bạn không có quyền với khách này). Vui lòng liên hệ quản trị viên.';
  return error.message;
};

let photoCounter = 0;

export const useAttachedPhotos = (customerId: string): AttachedPhotos => {
  const api = useCrmApi();
  const [photos, setPhotosState] = useState<AttachedPhoto[]>([]);
  // Ref luôn là danh sách mới nhất (đồng bộ) -> chọn file 2 lần liên tiếp không dùng số đếm cũ của closure.
  const photosRef = useRef<AttachedPhoto[]>([]);
  const setPhotos = useCallback((next: AttachedPhoto[]) => {
    photosRef.current = next;
    setPhotosState(next);
  }, []);
  const patchPhoto = useCallback(
    (key: string, patch: Partial<AttachedPhoto>) => setPhotos(photosRef.current.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo))),
    [setPhotos],
  );

  // Giải phóng object URL khi rời form.
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl)), []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const { accepted, skippedCount } = pickAcceptedFiles(Array.from(files), MAX_ATTACHED_PHOTOS - photosRef.current.length);
      const added = accepted.map<AttachedPhoto>((file) => ({ key: `photo-${(photoCounter += 1)}`, name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading' }));
      setPhotos([...photosRef.current, ...added]);
      await Promise.all(
        accepted.map(async (file, index) => {
          const result = await api.uploadCareLogAttachment(customerId, file);
          if (result.ok) patchPhoto(added[index].key, { status: 'ready', attachmentId: result.data.id });
          else patchPhoto(added[index].key, { status: 'error', errorMessage: describeUploadError(result.error) });
        }),
      );
      return skippedCount;
    },
    [api, customerId, patchPhoto, setPhotos],
  );

  const removePhoto = useCallback(
    (index: number) => {
      const target = photosRef.current[index];
      if (!target) return;
      URL.revokeObjectURL(target.previewUrl);
      setPhotos(photosRef.current.filter((_, photoIndex) => photoIndex !== index));
      if (target.attachmentId) void api.deleteCareLogAttachment(customerId, target.attachmentId);
    },
    [api, customerId, setPhotos],
  );

  const clearPhotos = useCallback(() => {
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
  }, [setPhotos]);

  return {
    photos,
    attachmentIds: photos.flatMap((photo) => (photo.attachmentId ? [photo.attachmentId] : [])),
    isUploading: photos.some((photo) => photo.status === 'uploading'),
    addFiles,
    removePhoto,
    clearPhotos,
  };
};
