/**
 * Mô hình form "Cập nhật Thông tin đầu tư" dùng chung 2 biến thể. Giá trị theo dạng chuẩn `Customer`
 * (ngân sách = số tỷ VNĐ; các lựa chọn = nhãn tiếng Việt như dữ liệu mẫu).
 */
import { PROJECT_NAMES } from '@crm/data/mockData';
import type { CustomerChanges } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import type { FormErrors } from '../CreateCustomer/customerFormRules';

export interface InvestmentFormValues {
  interestedProjects: string[];
  /** Tỷ VNĐ; NaN = ô trống. */
  budgetMin: number;
  budgetMax: number;
  equityRatio: string;
  loanIncentive: boolean;
  propertyType: string;
  bedroomType: string;
  purchasePurposes: string[];
  criteriaPriorities: string[];
  searchArea: string;
  specificLocation: string;
  leadSource: string;
  targetPurchaseTime: string;
}

export type InvestmentField = keyof InvestmentFormValues;

export const INVESTMENT_FIELD_ORDER: readonly InvestmentField[] = ['interestedProjects', 'budgetMin', 'budgetMax'];

/** Danh mục dự án = PROJECTS của store + dự án ngoài danh mục mà nguồn Admin gợi ý ("The Rivus"). */
export const PROJECT_OPTIONS: readonly string[] = [...PROJECT_NAMES, 'The Rivus'];
export const PROJECT_QUICK_SUGGESTIONS: readonly string[] = [
  'Lumiere Riverside',
  'Masteri Centre Point',
  'Ecopark Grand',
  'Vinhomes Ocean Park',
];

export const EQUITY_RATIO_OPTIONS: readonly { value: string; description?: string }[] = [
  { value: '100% Tiền mặt' },
  { value: '70% (Cần vay 30%)' },
  { value: '60% (Cần vay 40%)', description: 'Tối ưu dòng tiền' },
  { value: '50% (Cần vay 50%)' },
];

export const PROPERTY_TYPE_OPTIONS: readonly string[] = ['Căn hộ chung cư', 'Nhà phố / Shophouse', 'Biệt thự / Villa', 'Đất nền'];

export const BEDROOM_OPTIONS: readonly string[] = ['1PN (45-55m²)', '2PN (65-78m²)', '3PN (85-115m²)', '4PN', 'Duplex / Penthouse'];

export const PURPOSE_SUGGESTIONS: readonly string[] = ['Ở thực', 'Đầu tư lâu dài & Cho thuê', 'Tích sản cho con', 'Lướt sóng'];
export const PRIORITY_SUGGESTIONS: readonly string[] = ['View sông / Công viên', 'Tầng cao thoáng', 'Gần trường quốc tế', 'Căn góc'];

export const SEARCH_AREA_OPTIONS: readonly string[] = [
  'Quận 7, TP.HCM',
  'Thủ Đức, TP.HCM',
  'Quận Bình Thạnh, TP.HCM',
  'Nhà Bè, TP.HCM',
  'Khu Đông TP.HCM / Vùng ven sinh thái',
  'Khu Tây TP.HCM',
  'Gia Lâm, Hà Nội',
];

export const TARGET_TIME_OPTIONS: readonly string[] = [
  'Ngay trong tuần',
  'Trong 1 tháng tới',
  'Trong 3 tháng tới',
  'Tháng 11/2026',
  'Quý 4/2026',
  'Quý 4/2026 (Khi ra hàng đợt 2)',
  'Quý 1/2027',
  'Chưa xác định',
];

/** Thêm giá trị hiện tại (dữ liệu cũ ngoài danh sách) vào cuối nhóm lựa chọn. */
export const withCurrentChoice = (options: readonly string[], current: string): string[] =>
  current && !options.includes(current) ? [...options, current] : [...options];

export const toInvestmentFormValues = (customer: Customer): InvestmentFormValues => ({
  interestedProjects: [...customer.interestedProjects],
  budgetMin: customer.budgetMin,
  budgetMax: customer.budgetMax,
  equityRatio: customer.equityRatio,
  loanIncentive: customer.loanIncentive,
  propertyType: customer.propertyType,
  bedroomType: customer.bedroomType,
  purchasePurposes: [...customer.purchasePurposes],
  criteriaPriorities: [...customer.criteriaPriorities],
  searchArea: customer.searchArea,
  specificLocation: customer.specificLocation,
  leadSource: customer.leadSource,
  targetPurchaseTime: customer.targetPurchaseTime,
});

/** Dự án quan tâm và ngân sách là bắt buộc (dấu * ở cả 2 nguồn). */
export const validateInvestment = (values: InvestmentFormValues): FormErrors<InvestmentField> => {
  const errors: FormErrors<InvestmentField> = {};
  if (values.interestedProjects.length === 0) errors.interestedProjects = 'Vui lòng chọn ít nhất 1 dự án quan tâm.';
  if (!Number.isFinite(values.budgetMin) || values.budgetMin <= 0) errors.budgetMin = 'Nhập ngân sách tối thiểu (lớn hơn 0).';
  if (!Number.isFinite(values.budgetMax) || values.budgetMax <= 0) errors.budgetMax = 'Nhập ngân sách tối đa (lớn hơn 0).';
  else if (Number.isFinite(values.budgetMin) && values.budgetMin > values.budgetMax) {
    errors.budgetMax = 'Ngân sách tối đa phải lớn hơn hoặc bằng mức tối thiểu.';
  }
  return errors;
};

export const toInvestmentChanges = (values: InvestmentFormValues): CustomerChanges => ({
  interestedProjects: [...values.interestedProjects],
  budgetMin: values.budgetMin,
  budgetMax: values.budgetMax,
  equityRatio: values.equityRatio,
  loanIncentive: values.loanIncentive,
  propertyType: values.propertyType,
  bedroomType: values.bedroomType,
  purchasePurposes: [...values.purchasePurposes],
  criteriaPriorities: [...values.criteriaPriorities],
  searchArea: values.searchArea,
  specificLocation: values.specificLocation.trim(),
  leadSource: values.leadSource,
  targetPurchaseTime: values.targetPurchaseTime,
});
