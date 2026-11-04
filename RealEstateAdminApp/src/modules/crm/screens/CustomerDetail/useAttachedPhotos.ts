/**
 * Ảnh đính kèm của form "Thêm/Sửa nhật ký chăm sóc" (C2): mỗi ảnh được TẢI LÊN NGAY qua `POST care-log-attachments`
 * (jpeg/png/webp, ≤ 5 MB; server kiểm magic bytes, bỏ EXIF/GPS, đổi tên UUID) và giữ lại `attachmentId` để gắn vào nhật ký khi lưu.
 * Xem trước bằng object URL cục bộ (không đọc ảnh vào bộ nhớ dưới dạng data URL). Tối đa 5 ảnh/ghi chú.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_NOTE, useCrmApi, type ApiError, type CareLogView } from '@crm/api';

export const MAX_ATTACHED_PHOTOS = ATTACHMENT_MAX_PER_NOTE;
export const MAX_PHOTO_BYTES = ATTACHMENT_MAX_BYTES;

export type AttachedPhotoStatus = 'uploading' | 'ready' | 'error';

export interface AttachedPhoto {
  key: string;
  name: string;
  /** Object URL xem trước (cục bộ), hoặc URL có chữ ký của ảnh đã lưu khi `isExisting`. */
  previewUrl: string;
  status: AttachedPhotoStatus;
  /** Có khi `status = 'ready'`. */
  attachmentId?: string;
  errorMessage?: string;
  /** Ảnh ĐÃ gắn vào nhật ký được sửa (PT-022): bỏ khỏi form chỉ loại `attachmentId` khỏi danh sách gửi đi, KHÔNG xóa file ở kho. */
  isExisting?: boolean;
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
  /** Hủy form: xóa (best-effort) các ảnh MỚI đã tải lên nhưng chưa gắn; ảnh đã lưu của nhật ký giữ nguyên. */
  discardPhotos: () => void;
}

/** Ảnh đã lưu của một nhật ký -> danh sách ban đầu của form sửa (`images` và `attachmentIds` song song). */
export const toExistingPhotos = (log: Pick<CareLogView, 'images' | 'attachmentIds'>): AttachedPhoto[] =>
  log.images.flatMap((image, index) => {
    const attachmentId = log.attachmentIds[index];
    return attachmentId ? [{ key: `saved-${attachmentId}`, name: image.caption, previewUrl: image.src, status: 'ready' as const, attachmentId, isExisting: true }] : [];
  });

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

/** `initialPhotos`: ảnh sẵn có khi sửa nhật ký (xem `toExistingPhotos`); chỉ đọc ở lần dựng đầu. */
export const useAttachedPhotos = (customerId: string, initialPhotos: readonly AttachedPhoto[] = []): AttachedPhotos => {
  const api = useCrmApi();
  const [photos, setPhotosState] = useState<AttachedPhoto[]>(() => [...initialPhotos]);
  // Ref luôn là danh sách mới nhất (đồng bộ) -> chọn file 2 lần liên tiếp không dùng số đếm cũ của closure.
  const photosRef = useRef<AttachedPhoto[]>([...initialPhotos]);
  const setPhotos = useCallback((next: AttachedPhoto[]) => {
    photosRef.current = next;
    setPhotosState(next);
  }, []);
  const patchPhoto = useCallback(
    (key: string, patch: Partial<AttachedPhoto>) => setPhotos(photosRef.current.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo))),
    [setPhotos],
  );

  // `api`/`customerId` mới nhất cho bước dọn khi rời form (effect dọn chỉ chạy 1 lần lúc gỡ component, không được dùng closure cũ).
  const latestRef = useRef({ api, customerId });
  const isUnmountedRef = useRef(false);
  useEffect(() => {
    latestRef.current = { api, customerId };
  });

  // Rời form (đổi sang form khác, rời màn): giải phóng object URL và xóa (best-effort) ảnh MỚI đã tải lên nhưng chưa gắn vào nhật ký,
  // để bản nháp bị bỏ không để lại ảnh mồ côi (mỗi người chỉ được giữ tối đa `MAX_UNATTACHED_PER_UPLOADER` ảnh chưa gắn).
  // Lưu xong thì khay đã được dọn trước (`clearPhotos`) nên không xóa nhầm ảnh vừa gắn. Ảnh đã lưu dùng URL có chữ ký, không đụng tới.
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      const { api: latestApi, customerId: latestCustomerId } = latestRef.current;
      photosRef.current.forEach((photo) => {
        if (photo.isExisting) return;
        URL.revokeObjectURL(photo.previewUrl);
        if (photo.attachmentId) void latestApi.deleteCareLogAttachment(latestCustomerId, photo.attachmentId);
      });
    };
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const { accepted, skippedCount } = pickAcceptedFiles(Array.from(files), MAX_ATTACHED_PHOTOS - photosRef.current.length);
      const added = accepted.map<AttachedPhoto>((file) => ({ key: `photo-${(photoCounter += 1)}`, name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading' }));
      setPhotos([...photosRef.current, ...added]);
      await Promise.all(
        accepted.map(async (file, index) => {
          const result = await api.uploadCareLogAttachment(customerId, file);
          if (isUnmountedRef.current) {
            // Form đã bị gỡ lúc ảnh còn đang tải lên: không còn ai gắn ảnh này nên xóa luôn (best-effort).
            if (result.ok) void api.deleteCareLogAttachment(customerId, result.data.id);
            return;
          }
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
      if (!target.isExisting) URL.revokeObjectURL(target.previewUrl);
      setPhotos(photosRef.current.filter((_, photoIndex) => photoIndex !== index));
      // Ảnh đã lưu: chỉ bỏ khỏi danh sách gửi đi (PATCH `attachmentIds` thay thế toàn bộ); ảnh mới chưa gắn thì xóa khỏi kho.
      if (target.attachmentId && !target.isExisting) void api.deleteCareLogAttachment(customerId, target.attachmentId);
    },
    [api, customerId, setPhotos],
  );

  const clearPhotos = useCallback(() => {
    photosRef.current.forEach((photo) => !photo.isExisting && URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
  }, [setPhotos]);

  const discardPhotos = useCallback(() => {
    photosRef.current.forEach((photo) => {
      if (photo.isExisting) return;
      URL.revokeObjectURL(photo.previewUrl);
      if (photo.attachmentId) void api.deleteCareLogAttachment(customerId, photo.attachmentId);
    });
    setPhotos([]);
  }, [api, customerId, setPhotos]);

  return {
    photos,
    attachmentIds: photos.flatMap((photo) => (photo.attachmentId ? [photo.attachmentId] : [])),
    isUploading: photos.some((photo) => photo.status === 'uploading'),
    addFiles,
    removePhoto,
    clearPhotos,
    discardPhotos,
  };
};
