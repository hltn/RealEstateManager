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
export const DEFAULT_CURRENT_USER_ID = 'hanh';

export const SEED_CATALOGS: CrmCatalogs = {
  statuses: [
    { id: 'st-not-contacted', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'CARING', tone: 'gray', order: 1, isDefault: true, isSystem: true, isActive: true },
    { id: 'st-interested', code: 'INTERESTED', label: 'Có quan tâm', listGroup: 'CARING', tone: 'success', order: 2, isDefault: false, isSystem: true, isActive: true },
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
    { id: 'area-q1', name: 'Quận 1, TP.HCM', order: 1, isActive: true },
    { id: 'area-q7', name: 'Quận 7, TP.HCM', order: 2, isActive: true },
    { id: 'area-binh-thanh', name: 'Quận Bình Thạnh, TP.HCM', order: 3, isActive: true },
    { id: 'area-thu-duc', name: 'TP. Thủ Đức, TP.HCM', order: 4, isActive: true },
    { id: 'area-nha-be', name: 'Huyện Nhà Bè, TP.HCM', order: 5, isActive: true },
    { id: 'area-nam-tu-liem', name: 'Nam Từ Liêm, Hà Nội', order: 6, isActive: true },
    { id: 'area-long-bien', name: 'Long Biên, Hà Nội', order: 7, isActive: true },
    { id: 'area-gia-lam', name: 'Gia Lâm, Hà Nội', order: 8, isActive: true },
    { id: 'area-van-giang', name: 'Văn Giang, Hưng Yên', order: 9, isActive: true },
    { id: 'area-thu-dau-mot', name: 'TP. Thủ Dầu Một, Bình Dương', order: 10, isActive: true },
    { id: 'area-overseas', name: 'Nước ngoài', order: 11, isActive: true },
  ],
  projects: [
    { id: 'proj-1', code: 'QTERRA', name: "Q'Terra", fullName: "Q'Terra Residential Suites", location: 'Thủ Đức, TP.HCM', areaId: 'area-thu-duc', priceText: '95 - 130 triệu/m²', statusLabel: 'Đang mở bán Giai đoạn 2', segment: 'Cao cấp', isActive: true },
    { id: 'proj-2', code: 'PRIVIA', name: 'The Privia', fullName: 'The Privia', location: 'Bình Tân, TP.HCM', areaId: null, priceText: '48 - 55 triệu/m²', statusLabel: 'Sắp bàn giao', segment: 'Trung cao cấp', isActive: true },
    { id: 'proj-3', code: 'ECOPARK', name: 'Ecopark Grand', fullName: 'Ecopark Grand', location: 'Văn Giang, Hưng Yên', areaId: 'area-van-giang', priceText: '120 - 180 triệu/m²', statusLabel: 'Mở bán Vịnh Đảo', segment: 'Hạng sang', isActive: true },
    { id: 'proj-4', code: 'VHOP', name: 'Vinhomes Ocean Park', fullName: 'Vinhomes Ocean Park', location: 'Gia Lâm, Hà Nội', areaId: 'area-gia-lam', priceText: '45 - 90 triệu/m²', statusLabel: 'Đang vận hành', segment: 'Đại đô thị', isActive: true },
    { id: 'proj-5', code: 'LUMIERE', name: 'Lumiere Riverside', fullName: 'Lumiere Riverside', location: 'Thảo Điền, TP.HCM', areaId: 'area-thu-duc', priceText: '110 - 150 triệu/m²', statusLabel: 'Bàn giao hoàn thiện', segment: 'Hạng sang', isActive: true },
    { id: 'proj-6', code: 'MASTERI', name: 'Masteri Centre Point', fullName: 'Masteri Centre Point', location: 'Thủ Đức, TP.HCM', areaId: 'area-thu-duc', priceText: '65 - 85 triệu/m²', statusLabel: 'Đã nhận nhà', segment: 'Cao cấp', isActive: true },
    { id: 'proj-7', code: 'AQUA', name: 'Aqua City Waterfront', fullName: 'Aqua City Waterfront', location: 'Biên Hòa, Đồng Nai', areaId: null, priceText: '60 - 95 triệu/m²', statusLabel: 'Đang mở bán', segment: 'Đô thị sinh thái', isActive: true },
    { id: 'proj-8', code: 'VHGP', name: 'Vinhomes Grand Park', fullName: 'Vinhomes Grand Park', location: 'Thủ Đức, TP.HCM', areaId: 'area-thu-duc', priceText: '50 - 75 triệu/m²', statusLabel: 'Đang vận hành', segment: 'Đại đô thị', isActive: true },
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
  occasionLeadDays: 3,
  upcomingDays: 7,
};
