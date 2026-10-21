/**
 * State form "Cấu hình STND AI" (CRM). Store CRM chưa có nhánh cấu hình AI -> giữ cục bộ trong màn.
 * TODO(đề xuất): thêm `aiConfig` vào CrmDataState + action `updateAiConfig` (lưu localStorage như dữ liệu khác).
 */
import { useState } from 'react';
import { useCrmActions } from '@crm/store';

export interface CrmAiConfigValues {
  /** Ngưỡng điểm C4 (25/50/75/100) để gán nhãn Khách net. */
  dealScoreThreshold: number;
  isSmartSlotEnabled: boolean;
  isDuplicateCheckEnabled: boolean;
  isBirthdayReminderEnabled: boolean;
}

export type CrmAiToggleField = Exclude<keyof CrmAiConfigValues, 'dealScoreThreshold'>;

export const C4_STEP_PERCENT = 25;

/** Giá trị mặc định = trạng thái ban đầu của nguồn Admin (AIConfigView). */
export const DEFAULT_CRM_AI_CONFIG: CrmAiConfigValues = {
  dealScoreThreshold: 75,
  isSmartSlotEnabled: true,
  isDuplicateCheckEnabled: true,
  isBirthdayReminderEnabled: true,
};

const isSameConfig = (left: CrmAiConfigValues, right: CrmAiConfigValues): boolean =>
  (Object.keys(left) as (keyof CrmAiConfigValues)[]).every((key) => left[key] === right[key]);

export interface CrmAiConfigFormApi {
  values: CrmAiConfigValues;
  hasChanges: boolean;
  isDefault: boolean;
  setThreshold: (value: number) => void;
  setToggle: (field: CrmAiToggleField, isEnabled: boolean) => void;
  save: () => void;
  resetToDefault: () => void;
}

export const useCrmAiConfigForm = (): CrmAiConfigFormApi => {
  const { showToast } = useCrmActions();
  const [savedValues, setSavedValues] = useState<CrmAiConfigValues>(DEFAULT_CRM_AI_CONFIG);
  const [values, setValues] = useState<CrmAiConfigValues>(DEFAULT_CRM_AI_CONFIG);

  return {
    values,
    hasChanges: !isSameConfig(values, savedValues),
    isDefault: isSameConfig(values, DEFAULT_CRM_AI_CONFIG),
    setThreshold: (value) => setValues((current) => ({ ...current, dealScoreThreshold: value })),
    setToggle: (field, isEnabled) => setValues((current) => ({ ...current, [field]: isEnabled })),
    save: () => {
      setSavedValues(values);
      showToast({ title: 'Đã lưu cấu hình STND AI thành công!' });
    },
    resetToDefault: () => setValues(DEFAULT_CRM_AI_CONFIG),
  };
};
