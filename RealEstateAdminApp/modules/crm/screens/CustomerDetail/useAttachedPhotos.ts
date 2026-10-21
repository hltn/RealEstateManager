/**
 * Danh sách ảnh đính kèm của form "Thêm nhật ký chăm sóc" (state cục bộ).
 * Prototype chỉ mô phỏng upload: mỗi lần "Đính kèm" thêm 1 ảnh mẫu tiếp theo trong thư viện dự án.
 */
import { useCallback, useState } from 'react';
import { GALLERY_IMAGES } from '@crm/data/mockData';
import type { GalleryImage } from '@crm/types/crm';

export interface AttachedPhotos {
  photos: GalleryImage[];
  addSamplePhoto: () => void;
  removePhoto: (index: number) => void;
  clearPhotos: () => void;
}

export const useAttachedPhotos = (initialPhotos: GalleryImage[] = GALLERY_IMAGES): AttachedPhotos => {
  const [photos, setPhotos] = useState<GalleryImage[]>(initialPhotos);

  const addSamplePhoto = useCallback(() => {
    setPhotos((current) => [...current, GALLERY_IMAGES[current.length % GALLERY_IMAGES.length]]);
  }, []);

  const removePhoto = useCallback((index: number) => {
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
  }, []);

  const clearPhotos = useCallback(() => setPhotos([]), []);

  return { photos, addSamplePhoto, removePhoto, clearPhotos };
};
