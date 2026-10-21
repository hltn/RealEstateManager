/**
 * Ô địa điểm gặp mặt + nút "Dùng địa chỉ văn phòng dự án" (nguồn Mobile: nút my_location trang trí).
 * Ô nhập dùng chung lớp `getInputClass` của form kit; nút định vị nằm trong mép phải ô (`hasRightAddon`).
 */
import { LocateFixed, MapPin } from 'lucide-react';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { getErrorId } from '@crm/components/form/FormField';
import { getInputClass, INPUT_ICON_CLASS } from '@crm/lib/uiClasses';
import { getProjectOfficeLocation } from '../createAppointmentForm';

interface LocationInputProps {
  id: string;
  value: string;
  projectName: string;
  /** Thông báo lỗi (nếu có) — viền đỏ + `aria-describedby` tới dòng lỗi của `FormField`. */
  error?: string;
  onChange: (location: string) => void;
}

export const LocationInput = ({ id, value, projectName, error, onChange }: LocationInputProps) => {
  const officeLocation = getProjectOfficeLocation(projectName);
  return (
    <div className="relative">
      <MapPin size={18} aria-hidden="true" className={INPUT_ICON_CLASS} />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Nhập địa chỉ hoặc dùng văn phòng dự án"
        className={getInputClass({ hasError: Boolean(error), hasLeftIcon: true, hasRightAddon: true })}
        {...getFieldA11yProps(getErrorId(id), error)}
      />
      <button
        type="button"
        title="Dùng địa chỉ văn phòng bán hàng của dự án"
        aria-label="Dùng địa chỉ văn phòng bán hàng của dự án"
        disabled={!officeLocation}
        onClick={() => onChange(officeLocation)}
        className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-brand-50 hover:text-brand-500 disabled:opacity-40 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
      >
        <LocateFixed size={18} aria-hidden="true" />
      </button>
    </div>
  );
};
