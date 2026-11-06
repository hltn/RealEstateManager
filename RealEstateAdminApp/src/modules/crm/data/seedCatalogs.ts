/**
 * Dữ liệu seed danh mục + người dùng + cấu hình của prototype CRM (X7).
 * NGUỒN DUY NHẤT cho seed: store nạp bản sao vào state; mọi form/bộ lọc đọc danh mục từ store (không import hằng số này).
 */
import type { CrmCatalogs, CrmSettings, CrmUser, Team } from '@crm/types/crm';

export const SEED_TEAMS: Team[] = [
  { id: 'team-1', name: 'Nhóm Kinh doanh 1', managerIds: ['hanh'] },
  { id: 'team-2', name: 'Nhóm Kinh doanh 2', managerIds: ['minh'] },
];

export const SEED_USERS: CrmUser[] = [
  { id: 'admin', fullName: 'Quản trị hệ thống', displayName: 'Admin', role: 'ADMIN', jobTitle: 'Quản trị', teamId: null, isActive: true },
  { id: 'hanh', fullName: 'Trần Mỹ Hạnh', displayName: 'Hạnh', role: 'MANAGER', jobTitle: 'Trưởng nhóm kinh doanh', teamId: 'team-1', isActive: true },
  { id: 'thao', fullName: 'Phan Thu Thảo', displayName: 'Thảo', role: 'STAFF', jobTitle: 'Chuyên viên kinh doanh', teamId: 'team-1', isActive: true },
  { id: 'tuan', fullName: 'Nguyễn Anh Tuấn', displayName: 'Tuấn', role: 'STAFF', jobTitle: 'Chuyên viên tư vấn', teamId: 'team-1', isActive: true },
  { id: 'trang', fullName: 'Nguyễn Thu Trang', displayName: 'Trang', role: 'STAFF', jobTitle: 'Chuyên viên tư vấn', teamId: 'team-1', isActive: true },
  { id: 'minh', fullName: 'Lê Quang Minh', displayName: 'Minh', role: 'MANAGER', jobTitle: 'Trưởng nhóm kinh doanh', teamId: 'team-2', isActive: true },
  { id: 'tung', fullName: 'Vũ Thanh Tùng', displayName: 'Tùng', role: 'STAFF', jobTitle: 'Chuyên viên tư vấn', teamId: 'team-2', isActive: true },
  { id: 'vy', fullName: 'Đỗ Hà Vy', displayName: 'Vy', role: 'STAFF', jobTitle: 'Chuyên viên hỗ trợ', teamId: 'team-2', isActive: true },
  { id: 'quan', fullName: 'Trần Hoàng Quân', displayName: 'Quân', role: 'STAFF', jobTitle: 'Thực tập sinh kinh doanh', teamId: 'team-2', isActive: true },
];

/** Người dùng đăng nhập mặc định của prototype (đổi được bằng bộ chuyển "đăng nhập giả" ở môi trường dev). */
/** Người dùng MẪU của store mock (Quản trị: thấy mọi khách mẫu, được xuất/nhập file mẫu). */
export const DEFAULT_CURRENT_USER_ID = 'admin';

export const SEED_CATALOGS: CrmCatalogs = {
  statuses: [
    { id: 'NOT_CONTACTED', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray', order: 1, isDefault: true, isSystem: true, isActive: true },
    { id: 'INTERESTED', code: 'INTERESTED', label: 'Có quan tâm', listGroup: 'INTERESTED', tone: 'success', order: 2, isDefault: false, isSystem: true, isActive: true },
    { id: 'NET', code: 'NET', label: 'Khách net', listGroup: 'NET', tone: 'warning', order: 3, isDefault: false, isSystem: true, isActive: true },
    { id: 'DROPPED', code: 'DROPPED', label: 'Bỏ', listGroup: 'DROPPED', tone: 'error', order: 4, isDefault: false, isSystem: true, isActive: true },
  ],
  leadSources: [
    { id: 'WEBSITE', label: 'Website STND', order: 1, isActive: true },
    { id: 'FACEBOOK_ADS', label: 'Facebook Ads', order: 2, isActive: true },
    { id: 'GOOGLE_ADS', label: 'Google Search Ads', order: 3, isActive: true },
    { id: 'REFERRAL', label: 'Khách giới thiệu', order: 4, isActive: true },
    { id: 'TELESALES', label: 'Telesales data nội bộ', order: 5, isActive: true },
    { id: 'EVENT', label: 'Sự kiện mở bán', order: 6, isActive: true },
  ],
  areas: [
    { id: 'HA_NOI', name: 'Hà Nội', order: 1, isActive: true },
    { id: 'HUE', name: 'Huế', order: 2, isActive: true },
    { id: 'LAI_CHAU', name: 'Lai Châu', order: 3, isActive: true },
    { id: 'DIEN_BIEN', name: 'Điện Biên', order: 4, isActive: true },
    { id: 'SON_LA', name: 'Sơn La', order: 5, isActive: true },
    { id: 'LANG_SON', name: 'Lạng Sơn', order: 6, isActive: true },
    { id: 'QUANG_NINH', name: 'Quảng Ninh', order: 7, isActive: true },
    { id: 'THANH_HOA', name: 'Thanh Hóa', order: 8, isActive: true },
    { id: 'NGHE_AN', name: 'Nghệ An', order: 9, isActive: true },
    { id: 'HA_TINH', name: 'Hà Tĩnh', order: 10, isActive: true },
    { id: 'CAO_BANG', name: 'Cao Bằng', order: 11, isActive: true },
    { id: 'TUYEN_QUANG', name: 'Tuyên Quang', order: 12, isActive: true },
    { id: 'LAO_CAI', name: 'Lào Cai', order: 13, isActive: true },
    { id: 'THAI_NGUYEN', name: 'Thái Nguyên', order: 14, isActive: true },
    { id: 'PHU_THO', name: 'Phú Thọ', order: 15, isActive: true },
    { id: 'BAC_NINH', name: 'Bắc Ninh', order: 16, isActive: true },
    { id: 'HUNG_YEN', name: 'Hưng Yên', order: 17, isActive: true },
    { id: 'HAI_PHONG', name: 'Hải Phòng', order: 18, isActive: true },
    { id: 'NINH_BINH', name: 'Ninh Bình', order: 19, isActive: true },
    { id: 'QUANG_TRI', name: 'Quảng Trị', order: 20, isActive: true },
    { id: 'DA_NANG', name: 'Đà Nẵng', order: 21, isActive: true },
    { id: 'QUANG_NGAI', name: 'Quảng Ngãi', order: 22, isActive: true },
    { id: 'GIA_LAI', name: 'Gia Lai', order: 23, isActive: true },
    { id: 'KHANH_HOA', name: 'Khánh Hòa', order: 24, isActive: true },
    { id: 'LAM_DONG', name: 'Lâm Đồng', order: 25, isActive: true },
    { id: 'DAK_LAK', name: 'Đắk Lắk', order: 26, isActive: true },
    { id: 'TP_HO_CHI_MINH', name: 'TP. Hồ Chí Minh', order: 27, isActive: true },
    { id: 'DONG_NAI', name: 'Đồng Nai', order: 28, isActive: true },
    { id: 'TAY_NINH', name: 'Tây Ninh', order: 29, isActive: true },
    { id: 'CAN_THO', name: 'Cần Thơ', order: 30, isActive: true },
    { id: 'VINH_LONG', name: 'Vĩnh Long', order: 31, isActive: true },
    { id: 'DONG_THAP', name: 'Đồng Tháp', order: 32, isActive: true },
    { id: 'CA_MAU', name: 'Cà Mau', order: 33, isActive: true },
    { id: 'AN_GIANG', name: 'An Giang', order: 34, isActive: true },
  ],
  projects: [
    { id: 'QTERRA', code: 'QTERRA', name: "Q'Terra", fullName: "Q'Terra Residential Suites", developer: 'STND Group', location: 'Thủ Đức, TP.HCM', areaId: 'TP_HO_CHI_MINH', propertyTypes: ['Căn hộ'], priceFrom: 95_000_000, priceTo: 130_000_000, priceUnit: 'PER_SQM', status: 'SELLING', segment: 'Cao cấp', isActive: true, deletedAt: null },
    { id: 'PRIVIA', code: 'PRIVIA', name: 'The Privia', fullName: 'The Privia', developer: 'Khang Điền', location: 'Bình Tân, TP.HCM', areaId: null, propertyTypes: ['Căn hộ'], priceFrom: 48_000_000, priceTo: 55_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Trung cao cấp', isActive: true, deletedAt: null },
    { id: 'ECOPARK', code: 'ECOPARK', name: 'Ecopark Grand', fullName: 'Ecopark Grand', developer: 'Ecopark Corp', location: 'Văn Giang, Hưng Yên', areaId: 'HUNG_YEN', propertyTypes: ['Biệt thự', 'Nhà phố'], priceFrom: 120_000_000, priceTo: 180_000_000, priceUnit: 'PER_SQM', status: 'SELLING', segment: 'Hạng sang', isActive: true, deletedAt: null },
    { id: 'VHOP', code: 'VHOP', name: 'Vinhomes Ocean Park', fullName: 'Vinhomes Ocean Park', developer: 'Vinhomes', location: 'Gia Lâm, Hà Nội', areaId: 'HA_NOI', propertyTypes: ['Căn hộ', 'Shophouse'], priceFrom: 45_000_000, priceTo: 90_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Đại đô thị', isActive: true, deletedAt: null },
    { id: 'LUMIERE', code: 'LUMIERE', name: 'Lumiere Riverside', fullName: 'Lumiere Riverside', developer: 'An Gia', location: 'Thảo Điền, TP.HCM', areaId: 'TP_HO_CHI_MINH', propertyTypes: ['Căn hộ'], priceFrom: 110_000_000, priceTo: 150_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Hạng sang', isActive: true, deletedAt: null },
    { id: 'MASTERI', code: 'MASTERI', name: 'Masteri Centre Point', fullName: 'Masteri Centre Point', developer: 'Masterise Homes', location: 'Thủ Đức, TP.HCM', areaId: 'TP_HO_CHI_MINH', propertyTypes: ['Căn hộ'], priceFrom: 65_000_000, priceTo: 85_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Cao cấp', isActive: true, deletedAt: null },
    { id: 'AQUA', code: 'AQUA', name: 'Aqua City Waterfront', fullName: 'Aqua City Waterfront', developer: 'Nova Land', location: 'Biên Hòa, Đồng Nai', areaId: null, propertyTypes: ['Nhà phố', 'Biệt thự'], priceFrom: 60_000_000, priceTo: 95_000_000, priceUnit: 'PER_SQM', status: 'SELLING', segment: 'Đô thị sinh thái', isActive: true, deletedAt: null },
    { id: 'VHGP', code: 'VHGP', name: 'Vinhomes Grand Park', fullName: 'Vinhomes Grand Park', developer: 'Vinhomes', location: 'Thủ Đức, TP.HCM', areaId: 'TP_HO_CHI_MINH', propertyTypes: ['Căn hộ', 'Shophouse'], priceFrom: 50_000_000, priceTo: 75_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Đại đô thị', isActive: true, deletedAt: null },
  ],
  tags: [
    { id: 'tag-golf', name: 'Golf', category: 'INTEREST', isActive: true },
    { id: 'tag-gym', name: 'Gym', category: 'INTEREST', isActive: true },
    { id: 'tag-travel', name: 'Du lịch nghỉ dưỡng', category: 'INTEREST', isActive: true },
    { id: 'tag-pets', name: 'Nuôi thú cưng', category: 'INTEREST', isActive: true },
    { id: 'tag-yacht', name: 'Du thuyền', category: 'INTEREST', isActive: true },
    { id: 'tag-food', name: 'Ẩm thực', category: 'INTEREST', isActive: true },
    { id: 'tag-smarthome', name: 'Nhà thông minh', category: 'INTEREST', isActive: true },
    { id: 'tag-nature', name: 'Không gian xanh', category: 'INTEREST', isActive: true },
    { id: 'tag-business-owner', name: 'Doanh nhân', category: 'OCCUPATION', isActive: true },
    { id: 'tag-finance', name: 'Tài chính - Ngân hàng', category: 'OCCUPATION', isActive: true },
    { id: 'tag-tech', name: 'Công nghệ', category: 'OCCUPATION', isActive: true },
    { id: 'tag-manufacturing', name: 'Sản xuất', category: 'OCCUPATION', isActive: true },
    { id: 'tag-trading', name: 'Kinh doanh thương mại', category: 'OCCUPATION', isActive: true },
  ],
  contactResults: [
    { id: 'PRICE_QUOTE', label: 'Quan tâm giá / cần gửi bảng tính', suggestedFollowUpDays: 2, suggestionText: 'Gửi bảng tính dòng tiền rồi gọi lại xác nhận', order: 1, isActive: true },
    { id: 'SITE_VISIT', label: 'Hẹn xem sa bàn / nhà mẫu', suggestedFollowUpDays: 3, suggestionText: 'Xác nhận lịch xem nhà mẫu với khách', order: 2, isActive: true },
    { id: 'CALL_BACK', label: 'Bận, hẹn gọi lại', suggestedFollowUpDays: 1, suggestionText: 'Gọi lại vào khung giờ rảnh của khách', order: 3, isActive: true },
    { id: 'NO_ANSWER', label: 'Chưa liên hệ được', suggestedFollowUpDays: 1, suggestionText: 'Thử gọi lại khung giờ khác', order: 4, isActive: true },
    { id: 'LOAN_ADVICE', label: 'Cần tư vấn thêm gói vay', suggestedFollowUpDays: 2, suggestionText: 'Gửi phương án vay phù hợp', order: 5, isActive: true },
    { id: 'COMPARING', label: 'Đang so sánh dự án khác', suggestedFollowUpDays: 5, suggestionText: 'Gửi bảng so sánh các dự án khách quan tâm', order: 6, isActive: true },
    { id: 'DECLINED', label: 'Từ chối / không đúng nhu cầu', suggestedFollowUpDays: null, suggestionText: '', order: 7, isActive: true },
  ],
};

export const DEFAULT_SETTINGS: CrmSettings = {
  staleCustomerDays: 14,
  staleCheckTime: '08:00',
  occasionNotifyTime: '07:30',
  occasionLeadDays: [0, 1],
  defaultAppointmentReminderMinutes: [60, 1440],
  careLogEditWindowHours: 24,
  careLogNotifyDebounceMinutes: 10,
  phoneViewAlertPerHour: 200,
};
