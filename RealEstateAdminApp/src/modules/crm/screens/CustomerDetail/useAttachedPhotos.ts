/**
 * Danh sách ảnh đính kèm của form "Thêm nhật ký chăm sóc" (state cục bộ, mặc định RỖNG).
 * Prototype chưa có máy chủ lưu file: ảnh được đọc thành data URL ngay trên trình duyệt (giới hạn số ảnh + dung lượng
 * để không vượt quota localStorage). Khi có backend sẽ thay bằng upload S3 + UUID (skill mục 2 "File Upload").
 */
import { useCallback, useRef, useState } from 'react';
import type { GalleryImage } from '@crm/types/crm';

/** Tối đa số ảnh cho 1 nhật ký (giữ dữ liệu localStorage nhỏ). */
export const MAX_ATTACHED_PHOTOS = 4;
/** Dung lượng file gốc tối đa được chọn (byte) — 5 MB; ảnh được nén lại phía client trước khi lưu. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Mục tiêu dung lượng sau nén (ký tự data URL, ~200 KB). */
export const TARGET_PHOTO_DATA_URL_LENGTH = 270_000;
/** Quá thời gian này mà ảnh chưa giải mã xong thì bỏ nén. */
const IMAGE_LOAD_TIMEOUT_MS = 1500;
/** Cạnh dài tối đa sau khi thu nhỏ (px). */
export const MAX_PHOTO_DIMENSION = 1280;

const ACCEPTED_IMAGE_PATTERN = /^image\/(png|jpe?g|webp|gif)$/;

export interface AttachedPhotos {
  photos: GalleryImage[];
  /** Thêm ảnh từ file người dùng chọn; trả về số file bị bỏ qua (sai định dạng / quá lớn / quá số lượng). */
  addFiles: (files: FileList | File[]) => Promise<number>;
  removePhoto: (index: number) => void;
  clearPhotos: () => void;
}

/** Kích thước sau thu nhỏ: giữ tỉ lệ, cạnh dài không quá `max`, không phóng to. */
export const getScaledSize = (width: number, height: number, max: number = MAX_PHOTO_DIMENSION): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
};

/** Nén ảnh bằng canvas: thu nhỏ rồi giảm chất lượng JPEG dần tới khi đạt mục tiêu dung lượng. */
const compressToDataUrl = async (file: File): Promise<string> => {
  const original = await readAsDataUrl(file);
  if (typeof document === 'undefined' || typeof Image === 'undefined') return original;
  const image = new Image();
  const isLoaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    // Môi trường không giải mã được ảnh (không bao giờ bắn onload/onerror) -> dùng ảnh gốc thay vì treo.
    setTimeout(() => resolve(false), IMAGE_LOAD_TIMEOUT_MS);
  });
  image.src = original;
  if (!(await isLoaded)) return original;
  const { width, height } = getScaledSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return original;
  // Nền trắng trước khi vẽ: PNG trong suốt xuất JPEG sẽ không bị đen.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= TARGET_PHOTO_DATA_URL_LENGTH) return result;
  }
  return canvas.toDataURL('image/jpeg', 0.25);
};

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** File hợp lệ: đúng MIME ảnh và không vượt dung lượng. */
export const isAcceptedPhotoFile = (file: Pick<File, 'type' | 'size'>): boolean =>
  ACCEPTED_IMAGE_PATTERN.test(file.type) && file.size <= MAX_PHOTO_BYTES;

export const useAttachedPhotos = (initialPhotos: GalleryImage[] = []): AttachedPhotos => {
  const [photos, setPhotosState] = useState<GalleryImage[]>(initialPhotos);
  // Ref luôn là danh sách mới nhất (đồng bộ) -> chọn file 2 lần liên tiếp không dùng số đếm cũ của closure.
  const photosRef = useRef<GalleryImage[]>(initialPhotos);
  const setPhotos = useCallback((update: (current: GalleryImage[]) => GalleryImage[]) => {
    photosRef.current = update(photosRef.current);
    setPhotosState(photosRef.current);
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const candidates = Array.from(files);
      const valid = candidates.filter(isAcceptedPhotoFile);
      // Giữ chỗ ngay lập tức (đồng bộ) cho số ảnh còn trống để lần gọi kế tiếp thấy đúng số chỗ còn lại.
      const freeSlots = Math.max(0, MAX_ATTACHED_PHOTOS - photosRef.current.length);
      const accepted = valid.slice(0, freeSlots);
      const reserved = photosRef.current.length + accepted.length;
      photosRef.current = [...photosRef.current, ...accepted.map((file) => ({ src: '', caption: file.name }))];
      const placeholderStart = reserved - accepted.length;
      const images = await Promise.all(accepted.map(async (file) => ({ src: await compressToDataUrl(file), caption: file.name })));
      photosRef.current = [...photosRef.current.slice(0, placeholderStart), ...images, ...photosRef.current.slice(reserved)];
      setPhotosState(photosRef.current);
      return candidates.length - images.length;
    },
    [],
  );

  const removePhoto = useCallback((index: number) => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index)), [setPhotos]);

  const clearPhotos = useCallback(() => setPhotos(() => []), [setPhotos]);

  return { photos, addFiles, removePhoto, clearPhotos };
};
