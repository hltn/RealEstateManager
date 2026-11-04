/**
 * Dữ liệu seed danh mục + người dùng + cấu hình của prototype CRM (X7).
 * NGUỒN DUY NHẤT cho seed: store nạp bản sao vào state; mọi form/bộ lọc đọc danh mục từ store (không import hằng số này).
 */
import type { AdminUser, CrmCatalogs, CrmSettings, Team } from '@crm/types/crm';

/**
 * [Prototype] Nhóm mẫu (backend `teams`): `managerIds` = Quản lý của nhóm (đổi ở Cài đặt > Nhóm), `code` bất biến sau khi tạo.
 * Thành viên nhóm KHÔNG lưu ở đây mà suy từ `user.teamIds` (giống backend: `users.teamIds`).
 */
export const SEED_TEAMS: Team[] = [
  { id: 'team-1', code: 'KD1', name: 'Nhóm Kinh doanh 1', managerIds: ['hanh'], isActive: true },
  { id: 'team-2', code: 'KD2', name: 'Nhóm Kinh doanh 2', managerIds: ['minh'], isActive: true },
  { id: 'team-3', code: 'KD3', name: 'Nhóm Kinh doanh 3', managerIds: ['huy'], isActive: true },
  { id: 'team-old', code: 'DAGIAI', name: 'Nhóm Dự án cũ (đã giải thể)', managerIds: [], isActive: false },
];

/**
 * [Prototype] Tài khoản mẫu — nguồn DUY NHẤT cho cả store CRM lẫn `/users`, `/auth/*` của mock adapter (xem `mocks/handlers/users.ts`).
 * Có đủ các tình huống phân quyền để duyệt giao diện: Quản trị, Quản lý, Nhân viên, nhiều vai trò (STAFF+EDITOR, MANAGER+STAFF),
 * nhân viên thuộc 2 nhóm, tài khoản chỉ có EDITOR (không dùng CRM), tài khoản bị khóa. Đăng nhập giả: mật khẩu bất kỳ.
 * `role` = vai trò cao nhất (ADMIN > MANAGER > STAFF; chỉ có EDITOR thì quy về STAFF như `crmRoleOf`); `teamId` = `teamIds[0]`.
 */
export const SEED_USERS: AdminUser[] = [
  { id: 'admin', email: 'admin@stnd.vn', fullName: 'Nguyễn Quản Trị', displayName: 'Admin', role: 'ADMIN', roles: ['ADMIN'], jobTitle: 'Quản trị hệ thống', teamId: null, teamIds: [], isActive: true },
  { id: 'hanh', email: 'hanh.tran@stnd.vn', fullName: 'Trần Mỹ Hạnh', displayName: 'Hạnh', role: 'MANAGER', roles: ['MANAGER'], jobTitle: 'Trưởng nhóm kinh doanh', teamId: 'team-1', teamIds: ['team-1'], isActive: true },
  { id: 'thao', email: 'thao.phan@stnd.vn', fullName: 'Phan Thu Thảo', displayName: 'Thảo', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên kinh doanh', teamId: 'team-1', teamIds: ['team-1'], isActive: true },
  { id: 'tuan', email: 'tuan.nguyen@stnd.vn', fullName: 'Nguyễn Anh Tuấn', displayName: 'Tuấn', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên tư vấn', teamId: 'team-1', teamIds: ['team-1'], isActive: true },
  { id: 'trang', email: 'trang.nguyen@stnd.vn', fullName: 'Nguyễn Thu Trang', displayName: 'Trang', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên tư vấn', teamId: 'team-1', teamIds: ['team-1'], isActive: true },
  { id: 'minh', email: 'minh.le@stnd.vn', fullName: 'Lê Quang Minh', displayName: 'Minh', role: 'MANAGER', roles: ['MANAGER'], jobTitle: 'Trưởng nhóm kinh doanh', teamId: 'team-2', teamIds: ['team-2'], isActive: true },
  { id: 'tung', email: 'tung.vu@stnd.vn', fullName: 'Vũ Thanh Tùng', displayName: 'Tùng', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên tư vấn', teamId: 'team-2', teamIds: ['team-2'], isActive: true },
  { id: 'vy', email: 'vy.do@stnd.vn', fullName: 'Đỗ Hà Vy', displayName: 'Vy', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên hỗ trợ', teamId: 'team-2', teamIds: ['team-2'], isActive: true },
  { id: 'quan', email: 'quan.tran@stnd.vn', fullName: 'Trần Hoàng Quân', displayName: 'Quân', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Thực tập sinh kinh doanh', teamId: 'team-2', teamIds: ['team-2'], isActive: true },
  // Nhiều vai trò / nhiều nhóm.
  { id: 'huy', email: 'huy.bui@stnd.vn', fullName: 'Bùi Gia Huy', displayName: 'Huy', role: 'MANAGER', roles: ['MANAGER', 'STAFF'], jobTitle: 'Trưởng nhóm kinh doanh 3 (kiêm tư vấn)', teamId: 'team-3', teamIds: ['team-3', 'team-1'], isActive: true },
  { id: 'khoa', email: 'khoa.dang@stnd.vn', fullName: 'Đặng Anh Khoa', displayName: 'Khoa', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên tư vấn (2 nhóm)', teamId: 'team-2', teamIds: ['team-2', 'team-3'], isActive: true },
  { id: 'lan', email: 'lan.ngo@stnd.vn', fullName: 'Ngô Mỹ Lan', displayName: 'Lan', role: 'STAFF', roles: ['STAFF', 'EDITOR'], jobTitle: 'Tư vấn kiêm biên tập nội dung', teamId: 'team-3', teamIds: ['team-3'], isActive: true },
  { id: 'phuc', email: 'phuc.vo@stnd.vn', fullName: 'Võ Hoàng Phúc', displayName: 'Phúc', role: 'STAFF', roles: ['STAFF'], jobTitle: 'Chuyên viên tư vấn (đã nghỉ)', teamId: 'team-3', teamIds: ['team-3'], isActive: false },
  // Tài khoản tin tức (không dùng CRM).
  { id: 'ha', email: 'le.thu.ha@stnd.vn', fullName: 'Lê Thu Hà', displayName: 'Lê Thu Hà', role: 'STAFF', roles: ['EDITOR'], jobTitle: 'Biên tập viên', teamId: null, teamIds: [], isActive: true },
  { id: 'bao', email: 'pham.quoc.bao@stnd.vn', fullName: 'Phạm Quốc Bảo', displayName: 'Phạm Quốc Bảo', role: 'STAFF', roles: ['EDITOR'], jobTitle: 'Biên tập viên', teamId: null, teamIds: [], isActive: true },
  { id: 'admin2', email: 'tran.minh.khoa@stnd.vn', fullName: 'Trần Minh Khoa', displayName: 'Trần Minh Khoa', role: 'ADMIN', roles: ['ADMIN', 'EDITOR'], jobTitle: 'Quản trị nội dung', teamId: null, teamIds: [], isActive: true },
];

/** Đăng nhập giả mặc định của prototype: Quản trị (vào thẳng /crm/today). Đổi tài khoản ở bộ chuyển "Tài khoản mẫu" trong CRM. */
export const DEFAULT_CURRENT_USER_ID = 'admin';

export const SEED_CATALOGS: CrmCatalogs = {
  statuses: [
    { id: 'st-not-contacted', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray', order: 1, isDefault: true, isSystem: true, isActive: true },
    { id: 'st-interested', code: 'INTERESTED', label: 'Có quan tâm', listGroup: 'INTERESTED', tone: 'success', order: 2, isDefault: false, isSystem: true, isActive: true },
    { id: 'st-net', code: 'NET', label: 'Khách net', listGroup: 'NET', tone: 'warning', order: 3, isDefault: false, isSystem: true, isActive: true },
    { id: 'st-dropped', code: 'DROPPED', label: 'Bỏ', listGroup: 'DROPPED', tone: 'error', order: 4, isDefault: false, isSystem: true, isActive: true },
  ],
  leadSources: [
    { id: 'src-website', label: 'Website STND', order: 1, isActive: true },
    { id: 'src-facebook', label: 'Facebook Ads', order: 2, isActive: true },
    { id: 'src-google', label: 'Google Search Ads', order: 3, isActive: true },
    { id: 'src-referral', label: 'Khách giới thiệu', order: 4, isActive: true },
    { id: 'src-telesales', label: 'Telesales data nội bộ', order: 5, isActive: true },
    { id: 'src-event', label: 'Sự kiện mở bán', order: 6, isActive: true },
  ],
  areas: [
    { id: 'area-ha-noi', name: 'Hà Nội', order: 1, isActive: true },
    { id: 'area-hue', name: 'Huế', order: 2, isActive: true },
    { id: 'area-lai-chau', name: 'Lai Châu', order: 3, isActive: true },
    { id: 'area-dien-bien', name: 'Điện Biên', order: 4, isActive: true },
    { id: 'area-son-la', name: 'Sơn La', order: 5, isActive: true },
    { id: 'area-lang-son', name: 'Lạng Sơn', order: 6, isActive: true },
    { id: 'area-quang-ninh', name: 'Quảng Ninh', order: 7, isActive: true },
    { id: 'area-thanh-hoa', name: 'Thanh Hóa', order: 8, isActive: true },
    { id: 'area-nghe-an', name: 'Nghệ An', order: 9, isActive: true },
    { id: 'area-ha-tinh', name: 'Hà Tĩnh', order: 10, isActive: true },
    { id: 'area-cao-bang', name: 'Cao Bằng', order: 11, isActive: true },
    { id: 'area-tuyen-quang', name: 'Tuyên Quang', order: 12, isActive: true },
    { id: 'area-lao-cai', name: 'Lào Cai', order: 13, isActive: true },
    { id: 'area-thai-nguyen', name: 'Thái Nguyên', order: 14, isActive: true },
    { id: 'area-phu-tho', name: 'Phú Thọ', order: 15, isActive: true },
    { id: 'area-bac-ninh', name: 'Bắc Ninh', order: 16, isActive: true },
    { id: 'area-hung-yen', name: 'Hưng Yên', order: 17, isActive: true },
    { id: 'area-hai-phong', name: 'Hải Phòng', order: 18, isActive: true },
    { id: 'area-ninh-binh', name: 'Ninh Bình', order: 19, isActive: true },
    { id: 'area-quang-tri', name: 'Quảng Trị', order: 20, isActive: true },
    { id: 'area-da-nang', name: 'Đà Nẵng', order: 21, isActive: true },
    { id: 'area-quang-ngai', name: 'Quảng Ngãi', order: 22, isActive: true },
    { id: 'area-gia-lai', name: 'Gia Lai', order: 23, isActive: true },
    { id: 'area-khanh-hoa', name: 'Khánh Hòa', order: 24, isActive: true },
    { id: 'area-lam-dong', name: 'Lâm Đồng', order: 25, isActive: true },
    { id: 'area-dak-lak', name: 'Đắk Lắk', order: 26, isActive: true },
    { id: 'area-tp-ho-chi-minh', name: 'TP. Hồ Chí Minh', order: 27, isActive: true },
    { id: 'area-dong-nai', name: 'Đồng Nai', order: 28, isActive: true },
    { id: 'area-tay-ninh', name: 'Tây Ninh', order: 29, isActive: true },
    { id: 'area-can-tho', name: 'Cần Thơ', order: 30, isActive: true },
    { id: 'area-vinh-long', name: 'Vĩnh Long', order: 31, isActive: true },
    { id: 'area-dong-thap', name: 'Đồng Tháp', order: 32, isActive: true },
    { id: 'area-ca-mau', name: 'Cà Mau', order: 33, isActive: true },
    { id: 'area-an-giang', name: 'An Giang', order: 34, isActive: true },
  ],
  projects: [
    { id: 'proj-1', code: 'QTERRA', name: "Q'Terra", fullName: "Q'Terra Residential Suites", developer: 'STND Group', location: 'Thủ Đức, TP.HCM', areaId: 'area-tp-ho-chi-minh', propertyTypes: ['Căn hộ'], priceFrom: 95_000_000, priceTo: 130_000_000, priceUnit: 'PER_SQM', status: 'SELLING', segment: 'Cao cấp', isActive: true, deletedAt: null },
    { id: 'proj-2', code: 'PRIVIA', name: 'The Privia', fullName: 'The Privia', developer: 'Khang Điền', location: 'Bình Tân, TP.HCM', areaId: null, propertyTypes: ['Căn hộ'], priceFrom: 48_000_000, priceTo: 55_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Trung cao cấp', isActive: true, deletedAt: null },
    { id: 'proj-3', code: 'ECOPARK', name: 'Ecopark Grand', fullName: 'Ecopark Grand', developer: 'Ecopark Corp', location: 'Văn Giang, Hưng Yên', areaId: 'area-hung-yen', propertyTypes: ['Biệt thự', 'Nhà phố'], priceFrom: 120_000_000, priceTo: 180_000_000, priceUnit: 'PER_SQM', status: 'SELLING', segment: 'Hạng sang', isActive: true, deletedAt: null },
    { id: 'proj-4', code: 'VHOP', name: 'Vinhomes Ocean Park', fullName: 'Vinhomes Ocean Park', developer: 'Vinhomes', location: 'Gia Lâm, Hà Nội', areaId: 'area-ha-noi', propertyTypes: ['Căn hộ', 'Shophouse'], priceFrom: 45_000_000, priceTo: 90_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Đại đô thị', isActive: true, deletedAt: null },
    { id: 'proj-5', code: 'LUMIERE', name: 'Lumiere Riverside', fullName: 'Lumiere Riverside', developer: 'An Gia', location: 'Thảo Điền, TP.HCM', areaId: 'area-tp-ho-chi-minh', propertyTypes: ['Căn hộ'], priceFrom: 110_000_000, priceTo: 150_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Hạng sang', isActive: true, deletedAt: null },
    { id: 'proj-6', code: 'MASTERI', name: 'Masteri Centre Point', fullName: 'Masteri Centre Point', developer: 'Masterise Homes', location: 'Thủ Đức, TP.HCM', areaId: 'area-tp-ho-chi-minh', propertyTypes: ['Căn hộ'], priceFrom: 65_000_000, priceTo: 85_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Cao cấp', isActive: true, deletedAt: null },
    { id: 'proj-7', code: 'AQUA', name: 'Aqua City Waterfront', fullName: 'Aqua City Waterfront', developer: 'Nova Land', location: 'Biên Hòa, Đồng Nai', areaId: null, propertyTypes: ['Nhà phố', 'Biệt thự'], priceFrom: 60_000_000, priceTo: 95_000_000, priceUnit: 'PER_SQM', status: 'SELLING', segment: 'Đô thị sinh thái', isActive: true, deletedAt: null },
    { id: 'proj-8', code: 'VHGP', name: 'Vinhomes Grand Park', fullName: 'Vinhomes Grand Park', developer: 'Vinhomes', location: 'Thủ Đức, TP.HCM', areaId: 'area-tp-ho-chi-minh', propertyTypes: ['Căn hộ', 'Shophouse'], priceFrom: 50_000_000, priceTo: 75_000_000, priceUnit: 'PER_SQM', status: 'SOLD_OUT', segment: 'Đại đô thị', isActive: true, deletedAt: null },
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
    { id: 'cr-price', label: 'Quan tâm giá / cần gửi bảng tính', suggestedFollowUpDays: 2, suggestionText: 'Gửi bảng tính dòng tiền rồi gọi lại xác nhận', order: 1, isActive: true },
    { id: 'cr-site-visit', label: 'Hẹn xem sa bàn / nhà mẫu', suggestedFollowUpDays: 3, suggestionText: 'Xác nhận lịch xem nhà mẫu với khách', order: 2, isActive: true },
    { id: 'cr-busy', label: 'Bận, hẹn gọi lại', suggestedFollowUpDays: 1, suggestionText: 'Gọi lại vào khung giờ rảnh của khách', order: 3, isActive: true },
    { id: 'cr-no-answer', label: 'Chưa liên hệ được', suggestedFollowUpDays: 1, suggestionText: 'Thử gọi lại khung giờ khác', order: 4, isActive: true },
    { id: 'cr-loan', label: 'Cần tư vấn thêm gói vay', suggestedFollowUpDays: 2, suggestionText: 'Gửi phương án vay phù hợp', order: 5, isActive: true },
    { id: 'cr-comparing', label: 'Đang so sánh dự án khác', suggestedFollowUpDays: 5, suggestionText: 'Gửi bảng so sánh các dự án khách quan tâm', order: 6, isActive: true },
    { id: 'cr-declined', label: 'Từ chối / không đúng nhu cầu', suggestedFollowUpDays: null, suggestionText: '', order: 7, isActive: true },
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
