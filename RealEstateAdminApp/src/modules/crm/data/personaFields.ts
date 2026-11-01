/**
 * Cấu hình trường chân dung (persona_fields, X10 — tài liệu 04 §3.4). Seed theo bảng gợi ý C10 của tài liệu 01,
 * TẤT CẢ đều không bắt buộc (QT9). Khi có backend, danh sách này lấy từ `GET /crm/persona-fields`.
 */
import type { PersonaFieldDefinition, PersonaGroupCode } from '@crm/types/crm';

export const PERSONA_GROUP_LABELS: Record<PersonaGroupCode, string> = {
  PERSONAL: 'Cá nhân',
  OCCUPATION: 'Nghề nghiệp',
  LIFESTYLE: 'Sở thích và lối sống',
  OCCASION: 'Dịp đặc biệt',
  FAMILY: 'Gia đình và quan hệ',
  CONTACT: 'Cách liên hệ',
  REAL_ESTATE: 'Nhu cầu BĐS',
};

const field = (
  definition: Pick<PersonaFieldDefinition, 'key' | 'label' | 'groupCode' | 'type'> & Partial<PersonaFieldDefinition>,
): PersonaFieldDefinition => ({
  weight: 1,
  suggestPriority: 50,
  isFilterable: false,
  isOccasion: false,
  linkedCriterion: null,
  isActive: true,
  ...definition,
});

export const MARITAL_STATUS_OPTIONS = ['Đã kết hôn', 'Độc thân', 'Ly hôn / Khác'];
export const DECISION_MAKER_OPTIONS = ['Vợ chồng cùng duyệt', 'Khách tự quyết', 'Tham khảo gia đình'];
export const CONTACT_CHANNEL_OPTIONS = ['Zalo', 'Điện thoại', 'Gặp mặt'];
export const PROPERTY_TYPE_OPTIONS = ['Căn hộ chung cư', 'Nhà phố / Shophouse', 'Biệt thự / Villa', 'Đất nền', 'Condotel / Nghỉ dưỡng'];
export const BEDROOM_OPTIONS = ['Studio / 1PN', '2PN (65-78m²)', '3PN (85-115m²)', '4PN', 'Duplex / Penthouse'];
export const PURCHASE_PURPOSE_OPTIONS = ['Ở thực', 'Đầu tư cho thuê', 'Đầu tư lâu dài', 'Mua cho con', 'Nghỉ dưỡng'];

export const PERSONA_FIELDS: PersonaFieldDefinition[] = [
  // Cá nhân
  field({ key: 'birthday', label: 'Ngày sinh', groupCode: 'PERSONAL', type: 'DATE', isOccasion: true, occasionLabel: 'Sinh nhật', suggestPriority: 10 }),
  field({ key: 'hometown', label: 'Quê quán', groupCode: 'PERSONAL', type: 'TEXT', suggestPriority: 40 }),
  field({ key: 'marital_status', label: 'Tình trạng hôn nhân', groupCode: 'PERSONAL', type: 'SELECT', options: MARITAL_STATUS_OPTIONS, suggestPriority: 30 }),
  field({ key: 'children', label: 'Con cái', groupCode: 'PERSONAL', type: 'TEXT', placeholder: 'VD: 2 con, học tiểu học', suggestPriority: 35 }),
  // Nghề nghiệp
  field({ key: 'occupation', label: 'Nghề nghiệp / chức vụ', groupCode: 'OCCUPATION', type: 'TEXT', isFilterable: true, suggestPriority: 5 }),
  field({ key: 'business_field', label: 'Ngành', groupCode: 'OCCUPATION', type: 'TEXT', suggestPriority: 45 }),
  // Gia đình
  field({ key: 'decision_maker', label: 'Người ra quyết định mua', groupCode: 'FAMILY', type: 'SELECT', options: DECISION_MAKER_OPTIONS, suggestPriority: 15 }),
  // Dịp đặc biệt
  field({ key: 'anniversary', label: 'Ngày kỷ niệm', groupCode: 'OCCASION', type: 'DATE', isOccasion: true, occasionLabel: 'Ngày kỷ niệm', suggestPriority: 60 }),
  field({ key: 'other_occasion_label', label: 'Dịp quan trọng khác', groupCode: 'OCCASION', type: 'TEXT', placeholder: 'VD: Ngày thành lập công ty', suggestPriority: 70 }),
  field({ key: 'other_occasion_date', label: 'Ngày của dịp khác', groupCode: 'OCCASION', type: 'DATE', isOccasion: true, occasionLabel: 'Dịp quan trọng', suggestPriority: 71 }),
  // Cách liên hệ
  field({ key: 'preferred_channel', label: 'Kênh liên hệ ưa thích', groupCode: 'CONTACT', type: 'SELECT', options: CONTACT_CHANNEL_OPTIONS, suggestPriority: 20 }),
  field({ key: 'free_time_slot', label: 'Khung giờ thuận tiện', groupCode: 'CONTACT', type: 'TEXT', placeholder: 'VD: 19:00 - 21:00', suggestPriority: 12 }),
  field({ key: 'salutation', label: 'Cách xưng hô', groupCode: 'CONTACT', type: 'TEXT', placeholder: 'VD: Anh An', suggestPriority: 25 }),
  // Nhu cầu BĐS (có cấu trúc để lọc/thống kê; liên kết tiêu chí chỉ để hiển thị)
  field({ key: 'property_type', label: 'Loại hình quan tâm', groupCode: 'REAL_ESTATE', type: 'SELECT', options: PROPERTY_TYPE_OPTIONS, linkedCriterion: 'demand', isFilterable: true, suggestPriority: 8 }),
  field({ key: 'bedroom_type', label: 'Cơ cấu phòng', groupCode: 'REAL_ESTATE', type: 'SELECT', options: BEDROOM_OPTIONS, linkedCriterion: 'demand', suggestPriority: 32 }),
  field({ key: 'purchase_purposes', label: 'Mục đích mua', groupCode: 'REAL_ESTATE', type: 'MULTI_SELECT', options: PURCHASE_PURPOSE_OPTIONS, linkedCriterion: 'motivation', isFilterable: true, suggestPriority: 9 }),
  field({ key: 'budget', label: 'Ngân sách (khoảng)', groupCode: 'REAL_ESTATE', type: 'NUMBER_RANGE', linkedCriterion: 'finance', suggestPriority: 7 }),
  field({ key: 'equity_ratio', label: 'Vốn tự có', groupCode: 'REAL_ESTATE', type: 'TEXT', linkedCriterion: 'finance', placeholder: 'VD: 60% (cần vay 40%)', suggestPriority: 33 }),
  field({ key: 'loan_support', label: 'Cần hỗ trợ vay', groupCode: 'REAL_ESTATE', type: 'BOOLEAN', linkedCriterion: 'finance', suggestPriority: 34 }),
  field({ key: 'expected_purchase_time', label: 'Thời điểm dự kiến mua', groupCode: 'REAL_ESTATE', type: 'TEXT', linkedCriterion: 'timing', placeholder: 'VD: Quý 4/2026', suggestPriority: 11 }),
  field({ key: 'criteria_priorities', label: 'Tiêu chí ưu tiên', groupCode: 'REAL_ESTATE', type: 'MULTI_SELECT', suggestPriority: 36 }),
  field({ key: 'search_area', label: 'Khu vực muốn mua', groupCode: 'REAL_ESTATE', type: 'TEXT', suggestPriority: 31 }),
  field({ key: 'specific_location', label: 'Vị trí cụ thể', groupCode: 'REAL_ESTATE', type: 'TEXT', suggestPriority: 37 }),
];
