import {
  AreaType,
  CatalogItemType,
  ListGroup,
} from '../catalogs/catalog.enums';
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

export interface SeedAreaNode {
  name: string;
  type: AreaType;
  children?: readonly SeedAreaNode[];
}

/**
 * Cây khu vực: prototype lưu phẳng ("Quận 7, TP.HCM"); backend tách thành tỉnh/thành -> quận/huyện
 * để lọc theo tỉnh tự bao gồm khu vực con (`ancestorIds`).
 */
export const SEED_AREA_TREE: readonly SeedAreaNode[] = [
  {
    name: 'TP. Hồ Chí Minh',
    type: AreaType.PROVINCE,
    children: [
      { name: 'Quận 1', type: AreaType.DISTRICT },
      { name: 'Quận 7', type: AreaType.DISTRICT },
      { name: 'Quận Bình Thạnh', type: AreaType.DISTRICT },
      { name: 'TP. Thủ Đức', type: AreaType.DISTRICT },
      { name: 'Huyện Nhà Bè', type: AreaType.DISTRICT },
    ],
  },
  {
    name: 'Hà Nội',
    type: AreaType.PROVINCE,
    children: [
      { name: 'Nam Từ Liêm', type: AreaType.DISTRICT },
      { name: 'Long Biên', type: AreaType.DISTRICT },
      { name: 'Gia Lâm', type: AreaType.DISTRICT },
    ],
  },
  {
    name: 'Hưng Yên',
    type: AreaType.PROVINCE,
    children: [{ name: 'Văn Giang', type: AreaType.DISTRICT }],
  },
  {
    name: 'Bình Dương',
    type: AreaType.PROVINCE,
    children: [{ name: 'TP. Thủ Dầu Một', type: AreaType.DISTRICT }],
  },
  { name: 'Nước ngoài', type: AreaType.OTHER },
];

export interface SeedProject {
  code: string;
  name: string;
  developer: string;
  location: string;
  /** [tỉnh/thành, quận/huyện] trong `SEED_AREA_TREE`; null = chưa gắn khu vực. */
  areaPath: readonly [string, string] | null;
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
    areaPath: ['TP. Hồ Chí Minh', 'TP. Thủ Đức'],
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
    areaPath: null,
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
    areaPath: ['Hưng Yên', 'Văn Giang'],
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
    areaPath: ['Hà Nội', 'Gia Lâm'],
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
    areaPath: ['TP. Hồ Chí Minh', 'TP. Thủ Đức'],
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
    areaPath: ['TP. Hồ Chí Minh', 'TP. Thủ Đức'],
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
    areaPath: null,
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
    areaPath: ['TP. Hồ Chí Minh', 'TP. Thủ Đức'],
    propertyTypes: ['Căn hộ', 'Shophouse'],
    priceFrom: 50_000_000,
    priceTo: 75_000_000,
    status: ProjectStatus.SOLD_OUT,
    description: 'Vinhomes Grand Park. Đại đô thị. Khoảng giá tính theo m².',
  },
];
