import {
  LinkedCriterion,
  PersonaFieldType,
  PersonaGroupCode,
} from './persona.constants';

/**
 * Dữ liệu seed chân dung (tài liệu 04 mục 3.4), đối chiếu `RealEstateAdminApp/src/modules/crm/data/personaFields.ts`.
 * Mọi trường đều TÙY CHỌN (QT9). Không seed trường nhạy cảm (tôn giáo, chính trị, sức khỏe...). Chỉ là DỮ LIỆU
 * KHỞI TẠO: seed không bao giờ ghi đè trường đã tồn tại (kể cả đã sửa, tắt hay xóa mềm).
 */

export interface SeedPersonaGroup {
  code: PersonaGroupCode;
  label: string;
  order: number;
}

export const SEED_PERSONA_GROUPS: readonly SeedPersonaGroup[] = [
  { code: PersonaGroupCode.PERSONAL, label: 'Cá nhân', order: 1 },
  { code: PersonaGroupCode.OCCUPATION, label: 'Nghề nghiệp', order: 2 },
  { code: PersonaGroupCode.LIFESTYLE, label: 'Sở thích và lối sống', order: 3 },
  { code: PersonaGroupCode.OCCASION, label: 'Dịp đặc biệt', order: 4 },
  { code: PersonaGroupCode.FAMILY, label: 'Gia đình và quan hệ', order: 5 },
  { code: PersonaGroupCode.CONTACT, label: 'Cách liên hệ', order: 6 },
  { code: PersonaGroupCode.REAL_ESTATE, label: 'Nhu cầu BĐS', order: 7 },
];

export interface SeedPersonaField {
  key: string;
  label: string;
  groupCode: PersonaGroupCode;
  type: PersonaFieldType;
  options?: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  suggestPriority: number;
  isFilterable?: boolean;
  isOccasion?: boolean;
  occasionLabel?: string;
  linkedCriterion?: LinkedCriterion;
}

const options = (
  ...pairs: Array<[value: string, label: string]>
): Array<{ value: string; label: string }> =>
  pairs.map(([value, label]) => ({ value, label }));

/** Thứ tự trong mảng = `order` toàn cục (1, 2, 3...). */
export const SEED_PERSONA_FIELDS: readonly SeedPersonaField[] = [
  // Cá nhân
  {
    key: 'birthday',
    label: 'Ngày sinh',
    groupCode: PersonaGroupCode.PERSONAL,
    type: PersonaFieldType.DATE,
    isOccasion: true,
    occasionLabel: 'Sinh nhật',
    suggestPriority: 10,
  },
  {
    key: 'hometown',
    label: 'Quê quán',
    groupCode: PersonaGroupCode.PERSONAL,
    type: PersonaFieldType.TEXT,
    suggestPriority: 40,
  },
  {
    key: 'marital_status',
    label: 'Tình trạng hôn nhân',
    groupCode: PersonaGroupCode.PERSONAL,
    type: PersonaFieldType.SELECT,
    options: options(
      ['MARRIED', 'Đã kết hôn'],
      ['SINGLE', 'Độc thân'],
      ['DIVORCED_OTHER', 'Ly hôn / Khác'],
    ),
    suggestPriority: 30,
  },
  {
    key: 'children',
    label: 'Con cái',
    groupCode: PersonaGroupCode.PERSONAL,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: 2 con, học tiểu học',
    suggestPriority: 35,
  },
  // Nghề nghiệp
  {
    key: 'occupation',
    label: 'Nghề nghiệp / chức vụ',
    groupCode: PersonaGroupCode.OCCUPATION,
    type: PersonaFieldType.TEXT,
    isFilterable: true,
    suggestPriority: 5,
  },
  {
    key: 'business_field',
    label: 'Ngành',
    groupCode: PersonaGroupCode.OCCUPATION,
    type: PersonaFieldType.TEXT,
    suggestPriority: 45,
  },
  // Sở thích và lối sống
  {
    key: 'hobbies',
    label: 'Sở thích',
    groupCode: PersonaGroupCode.LIFESTYLE,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: golf, du lịch, nấu ăn',
    suggestPriority: 50,
  },
  {
    key: 'lifestyle',
    label: 'Phong cách sống',
    groupCode: PersonaGroupCode.LIFESTYLE,
    type: PersonaFieldType.TEXT,
    suggestPriority: 55,
  },
  // Gia đình và quan hệ
  {
    key: 'decision_maker',
    label: 'Người ra quyết định mua',
    groupCode: PersonaGroupCode.FAMILY,
    type: PersonaFieldType.SELECT,
    options: options(
      ['COUPLE', 'Vợ chồng cùng duyệt'],
      ['SELF', 'Khách tự quyết'],
      ['FAMILY_CONSULT', 'Tham khảo gia đình'],
    ),
    suggestPriority: 15,
  },
  // Dịp đặc biệt
  {
    key: 'anniversary',
    label: 'Ngày kỷ niệm',
    groupCode: PersonaGroupCode.OCCASION,
    type: PersonaFieldType.DATE,
    isOccasion: true,
    occasionLabel: 'Ngày kỷ niệm',
    suggestPriority: 60,
  },
  {
    key: 'other_occasion_label',
    label: 'Dịp quan trọng khác',
    groupCode: PersonaGroupCode.OCCASION,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: Ngày thành lập công ty',
    suggestPriority: 70,
  },
  {
    key: 'other_occasion_date',
    label: 'Ngày của dịp khác',
    groupCode: PersonaGroupCode.OCCASION,
    type: PersonaFieldType.DATE,
    isOccasion: true,
    occasionLabel: 'Dịp quan trọng',
    suggestPriority: 71,
  },
  // Cách liên hệ
  {
    key: 'preferred_channel',
    label: 'Kênh liên hệ ưa thích',
    groupCode: PersonaGroupCode.CONTACT,
    type: PersonaFieldType.SELECT,
    options: options(
      ['ZALO', 'Zalo'],
      ['PHONE', 'Điện thoại'],
      ['MEETING', 'Gặp mặt'],
    ),
    suggestPriority: 20,
  },
  {
    key: 'free_time_slot',
    label: 'Khung giờ thuận tiện',
    groupCode: PersonaGroupCode.CONTACT,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: 19:00 - 21:00',
    suggestPriority: 12,
  },
  {
    key: 'salutation',
    label: 'Cách xưng hô',
    groupCode: PersonaGroupCode.CONTACT,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: Anh An',
    suggestPriority: 25,
  },
  // Nhu cầu BĐS: có cấu trúc để lọc/thống kê; liên kết tiêu chí chỉ để hiển thị
  {
    key: 'property_type',
    label: 'Loại hình quan tâm',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.SELECT,
    options: options(
      ['APARTMENT', 'Căn hộ chung cư'],
      ['TOWNHOUSE', 'Nhà phố / Shophouse'],
      ['VILLA', 'Biệt thự / Villa'],
      ['LAND', 'Đất nền'],
      ['CONDOTEL', 'Condotel / Nghỉ dưỡng'],
    ),
    linkedCriterion: LinkedCriterion.DEMAND,
    isFilterable: true,
    suggestPriority: 8,
  },
  {
    key: 'bedroom_type',
    label: 'Cơ cấu phòng',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.SELECT,
    options: options(
      ['STUDIO_1BR', 'Studio / 1PN'],
      ['2BR', '2PN (65-78m²)'],
      ['3BR', '3PN (85-115m²)'],
      ['4BR', '4PN'],
      ['DUPLEX_PENTHOUSE', 'Duplex / Penthouse'],
    ),
    linkedCriterion: LinkedCriterion.DEMAND,
    suggestPriority: 32,
  },
  {
    key: 'purchase_purposes',
    label: 'Mục đích mua',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.MULTI_SELECT,
    options: options(
      ['LIVING', 'Ở thực'],
      ['INVEST_RENT', 'Đầu tư cho thuê'],
      ['INVEST_LONG_TERM', 'Đầu tư lâu dài'],
      ['FOR_CHILD', 'Mua cho con'],
      ['RESORT', 'Nghỉ dưỡng'],
    ),
    linkedCriterion: LinkedCriterion.MOTIVATION,
    isFilterable: true,
    suggestPriority: 9,
  },
  {
    key: 'budget',
    label: 'Ngân sách (khoảng)',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.NUMBER_RANGE,
    linkedCriterion: LinkedCriterion.FINANCE,
    suggestPriority: 7,
  },
  {
    key: 'equity_ratio',
    label: 'Vốn tự có',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: 60% (cần vay 40%)',
    linkedCriterion: LinkedCriterion.FINANCE,
    suggestPriority: 33,
  },
  {
    key: 'loan_support',
    label: 'Cần hỗ trợ vay',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.BOOLEAN,
    linkedCriterion: LinkedCriterion.FINANCE,
    suggestPriority: 34,
  },
  {
    key: 'expected_purchase_time',
    label: 'Thời điểm dự kiến mua',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.TEXT,
    placeholder: 'VD: Quý 4/2026',
    linkedCriterion: LinkedCriterion.TIMING,
    suggestPriority: 11,
  },
  {
    key: 'criteria_priorities',
    label: 'Tiêu chí ưu tiên',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.MULTI_SELECT,
    options: options(
      ['PRICE', 'Giá'],
      ['LOCATION', 'Vị trí'],
      ['AMENITIES', 'Tiện ích'],
      ['LEGAL', 'Pháp lý'],
      ['DEVELOPER', 'Chủ đầu tư'],
      ['VIEW', 'View / hướng'],
    ),
    suggestPriority: 36,
  },
  {
    key: 'search_area',
    label: 'Khu vực muốn mua',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.TEXT,
    suggestPriority: 31,
  },
  {
    key: 'specific_location',
    label: 'Vị trí cụ thể',
    groupCode: PersonaGroupCode.REAL_ESTATE,
    type: PersonaFieldType.TEXT,
    suggestPriority: 37,
  },
];
