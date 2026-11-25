import { CatalogItemType, ListGroup } from '../catalogs/catalog.enums';
import { generateAreaCode } from '../common/utils/area-code.util';
import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';
import { ProjectStatus } from '../projects/project.rules';

/**
 * Dữ liệu seed danh mục + dự án M1, đối chiếu `RealEstateAdminApp/src/modules/crm/data/seedCatalogs.ts`.
 * Chỉ là DỮ LIỆU KHỞI TẠO: seed không bao giờ ghi đè bản ghi đã tồn tại (kể cả đã xóa mềm).
 */

export interface SeedStatus {
  code: string;
  label: string;
  listGroup: ListGroup;
  color: string;
  order: number;
  isDefault: boolean;
}

/** 4 tình trạng hệ thống, mỗi tình trạng một nhóm danh sách riêng (quyết định #9). */
export const SEED_STATUSES: readonly SeedStatus[] = [
  {
    code: 'NOT_CONTACTED',
    label: 'Chưa tiếp cận',
    listGroup: ListGroup.NOT_CONTACTED,
    color: 'gray',
    order: 1,
    isDefault: true,
  },
  {
    code: 'INTERESTED',
    label: 'Có quan tâm',
    listGroup: ListGroup.INTERESTED,
    color: 'success',
    order: 2,
    isDefault: false,
  },
  {
    code: 'NET',
    label: 'Khách net',
    listGroup: ListGroup.NET,
    color: 'warning',
    order: 3,
    isDefault: false,
  },
  {
    code: 'DROPPED',
    label: 'Bỏ',
    listGroup: ListGroup.DROPPED,
    color: 'error',
    order: 4,
    isDefault: false,
  },
];

export interface SeedCatalogItem {
  type: CatalogItemType;
  code: string;
  label: string;
  order: number;
  meta?: { suggestedFollowUpDays: number | null; suggestionText: string };
}

export const SEED_LEAD_SOURCES: readonly SeedCatalogItem[] = [
  {
    type: CatalogItemType.LEAD_SOURCE,
    code: 'WEBSITE',
    label: 'Website STND',
    order: 1,
  },
  {
    type: CatalogItemType.LEAD_SOURCE,
    code: 'FACEBOOK_ADS',
    label: 'Facebook Ads',
    order: 2,
  },
  {
    type: CatalogItemType.LEAD_SOURCE,
    code: 'GOOGLE_ADS',
    label: 'Google Search Ads',
    order: 3,
  },
  {
    type: CatalogItemType.LEAD_SOURCE,
    code: 'REFERRAL',
    label: 'Khách giới thiệu',
    order: 4,
  },
  {
    type: CatalogItemType.LEAD_SOURCE,
    code: 'TELESALES',
    label: 'Telesales data nội bộ',
    order: 5,
  },
  {
    type: CatalogItemType.LEAD_SOURCE,
    code: 'EVENT',
    label: 'Sự kiện mở bán',
    order: 6,
  },
];

export const SEED_CONTACT_RESULTS: readonly SeedCatalogItem[] = [
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'PRICE_QUOTE',
    label: 'Quan tâm giá / cần gửi bảng tính',
    order: 1,
    meta: {
      suggestedFollowUpDays: 2,
      suggestionText: 'Gửi bảng tính dòng tiền rồi gọi lại xác nhận',
    },
  },
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'SITE_VISIT',
    label: 'Hẹn xem sa bàn / nhà mẫu',
    order: 2,
    meta: {
      suggestedFollowUpDays: 3,
      suggestionText: 'Xác nhận lịch xem nhà mẫu với khách',
    },
  },
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'CALL_BACK',
    label: 'Bận, hẹn gọi lại',
    order: 3,
    meta: {
      suggestedFollowUpDays: 1,
      suggestionText: 'Gọi lại vào khung giờ rảnh của khách',
    },
  },
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'NO_ANSWER',
    label: 'Chưa liên hệ được',
    order: 4,
    meta: {
      suggestedFollowUpDays: 1,
      suggestionText: 'Thử gọi lại khung giờ khác',
    },
  },
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'LOAN_ADVICE',
    label: 'Cần tư vấn thêm gói vay',
    order: 5,
    meta: {
      suggestedFollowUpDays: 2,
      suggestionText: 'Gửi phương án vay phù hợp',
    },
  },
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'COMPARING',
    label: 'Đang so sánh dự án khác',
    order: 6,
    meta: {
      suggestedFollowUpDays: 5,
      suggestionText: 'Gửi bảng so sánh các dự án khách quan tâm',
    },
  },
  {
    type: CatalogItemType.CONTACT_RESULT,
    code: 'DECLINED',
    label: 'Từ chối / không đúng nhu cầu',
    order: 7,
    meta: { suggestedFollowUpDays: null, suggestionText: '' },
  },
];

/**
 * 34 tỉnh/thành phố của Việt Nam (hiệu lực từ 01/07/2025, Nghị quyết 202/2025/QH15: 28 tỉnh + 6 thành phố
 * trực thuộc Trung ương). Danh sách PHẲNG: chỉ cấp tỉnh/thành (`AreaType.PROVINCE`), không có quận/huyện/phường.
 * Thứ tự mảng chính là `order` hiển thị (1..34). `adminCode` để trống vì chưa đối chiếu được mã hành chính chính thức.
 */
export const SEED_PROVINCES: readonly string[] = [
  'Hà Nội',
  'Huế',
  'Lai Châu',
  'Điện Biên',
  'Sơn La',
  'Lạng Sơn',
  'Quảng Ninh',
  'Thanh Hóa',
  'Nghệ An',
  'Hà Tĩnh',
  'Cao Bằng',
  'Tuyên Quang',
  'Lào Cai',
  'Thái Nguyên',
  'Phú Thọ',
  'Bắc Ninh',
  'Hưng Yên',
  'Hải Phòng',
  'Ninh Bình',
  'Quảng Trị',
  'Đà Nẵng',
  'Quảng Ngãi',
  'Gia Lai',
  'Khánh Hòa',
  'Lâm Đồng',
  'Đắk Lắk',
  'TP. Hồ Chí Minh',
  'Đồng Nai',
  'Tây Ninh',
  'Cần Thơ',
  'Vĩnh Long',
  'Đồng Tháp',
  'Cà Mau',
  'An Giang',
];

/** Khóa seed bất biến của một tỉnh/thành (`AREA:<tên không dấu>`); seed và migration 006 dùng chung để không tạo trùng. */
export const provinceSeedKey = (name: string): string =>
  `AREA:${normalizeVietnamese(name)}`;

/**
 * Mã tham chiếu bất biến (`areas.code`) của một tỉnh/thành seed (FR-40). Xác định từ TÊN, không phụ thuộc thứ tự
 * chạy hay trạng thái DB; 34 tỉnh đảm bảo không trùng nhau (có test). Seed và migration 007 dùng chung.
 */
export const provinceCode = (name: string): string => generateAreaCode(name);

export interface SeedProject {
  code: string;
  name: string;
  developer: string;
  location: string;
  /** Tên tỉnh/thành trong `SEED_PROVINCES`; null = chưa gắn khu vực. */
  areaName: string | null;
  propertyTypes: readonly string[];
  priceFrom: number;
  priceTo: number;
  status: ProjectStatus;
  description: string;
}

/**
 * Dự án mẫu. Prototype có thêm `fullName`, `priceUnit`, `segment` không nằm trong hợp đồng API (tài liệu 04/05):
 * phân khúc + đơn vị giá (theo m²) được ghi vào `description` để không mất thông tin.
 */
export const SEED_PROJECTS: readonly SeedProject[] = [
  {
    code: 'QTERRA',
    name: "Q'Terra",
    developer: 'STND Group',
    location: 'Thủ Đức, TP.HCM',
    areaName: 'TP. Hồ Chí Minh',
    propertyTypes: ['Căn hộ'],
    priceFrom: 95_000_000,
    priceTo: 130_000_000,
    status: ProjectStatus.SELLING,
    description:
      "Q'Terra Residential Suites. Phân khúc cao cấp. Khoảng giá tính theo m².",
  },
  {
    code: 'PRIVIA',
    name: 'The Privia',
    developer: 'Khang Điền',
    location: 'Bình Tân, TP.HCM',
    areaName: 'TP. Hồ Chí Minh',
    propertyTypes: ['Căn hộ'],
    priceFrom: 48_000_000,
    priceTo: 55_000_000,
    status: ProjectStatus.SOLD_OUT,
    description:
      'The Privia. Phân khúc trung cao cấp. Khoảng giá tính theo m².',
  },
  {
    code: 'ECOPARK',
    name: 'Ecopark Grand',
    developer: 'Ecopark Corp',
    location: 'Văn Giang, Hưng Yên',
    areaName: 'Hưng Yên',
    propertyTypes: ['Biệt thự', 'Nhà phố'],
    priceFrom: 120_000_000,
    priceTo: 180_000_000,
    status: ProjectStatus.SELLING,
    description: 'Ecopark Grand. Phân khúc hạng sang. Khoảng giá tính theo m².',
  },
  {
    code: 'VHOP',
    name: 'Vinhomes Ocean Park',
    developer: 'Vinhomes',
    location: 'Gia Lâm, Hà Nội',
    areaName: 'Hà Nội',
    propertyTypes: ['Căn hộ', 'Shophouse'],
    priceFrom: 45_000_000,
    priceTo: 90_000_000,
    status: ProjectStatus.SOLD_OUT,
    description: 'Vinhomes Ocean Park. Đại đô thị. Khoảng giá tính theo m².',
  },
  {
    code: 'LUMIERE',
    name: 'Lumiere Riverside',
    developer: 'An Gia',
    location: 'Thảo Điền, TP.HCM',
    areaName: 'TP. Hồ Chí Minh',
    propertyTypes: ['Căn hộ'],
    priceFrom: 110_000_000,
    priceTo: 150_000_000,
    status: ProjectStatus.SOLD_OUT,
    description:
      'Lumiere Riverside. Phân khúc hạng sang. Khoảng giá tính theo m².',
  },
  {
    code: 'MASTERI',
    name: 'Masteri Centre Point',
    developer: 'Masterise Homes',
    location: 'Thủ Đức, TP.HCM',
    areaName: 'TP. Hồ Chí Minh',
    propertyTypes: ['Căn hộ'],
    priceFrom: 65_000_000,
    priceTo: 85_000_000,
    status: ProjectStatus.SOLD_OUT,
    description:
      'Masteri Centre Point. Phân khúc cao cấp. Khoảng giá tính theo m².',
  },
  {
    code: 'AQUA',
    name: 'Aqua City Waterfront',
    developer: 'Nova Land',
    location: 'Biên Hòa, Đồng Nai',
    areaName: 'Đồng Nai',
    propertyTypes: ['Nhà phố', 'Biệt thự'],
    priceFrom: 60_000_000,
    priceTo: 95_000_000,
    status: ProjectStatus.SELLING,
    description:
      'Aqua City Waterfront. Đô thị sinh thái. Khoảng giá tính theo m².',
  },
  {
    code: 'VHGP',
    name: 'Vinhomes Grand Park',
    developer: 'Vinhomes',
    location: 'Thủ Đức, TP.HCM',
    areaName: 'TP. Hồ Chí Minh',
    propertyTypes: ['Căn hộ', 'Shophouse'],
    priceFrom: 50_000_000,
    priceTo: 75_000_000,
    status: ProjectStatus.SOLD_OUT,
    description: 'Vinhomes Grand Park. Đại đô thị. Khoảng giá tính theo m².',
  },
];
