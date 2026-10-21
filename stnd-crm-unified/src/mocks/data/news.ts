import { isoMinutesAgo, mockObjectId } from '../utils';

/** Bài viết thô do crawler thu thập (mirror RawArticle mà RawArticlesScreen đọc). */
export interface MockRawArticle {
  _id: string;
  urlHash: string;
  title: string;
  description: string;
  source: string;
  url: string;
  thumbnailUrl?: string;
  publishedAt: string;
  isDuplicate: boolean;
  duplicateOfArticleId: string | null;
  duplicateScore: number | null;
  savedArticleId: string | null;
}

/** Bài viết đã duyệt (NewsArticle) — dùng cho ManageWpScreen, NewsDetailScreen, modal "Xem bài gốc". */
export interface MockNewsArticle {
  _id: string;
  title: string;
  summary: string;
  content: string;
  source: string;
  url: string;
  thumbnailUrl?: string;
  publishDate: string;
  createdAt: string;
  /** Mảng trạng thái: rỗng = chờ xử lý, `CRAWLED`, `POSTED_WP`, `ERROR`. */
  status: string[];
}

/** Bản ghi lịch sử phân tích thị trường. */
export interface MockMarketAnalysisHistory {
  _id: string;
  content: string;
  articleIds: string[];
  createdAt: string;
  googleDriveExport: {
    documentId: string;
    documentUrl: string;
    title: string;
    exportedAt: string;
  } | null;
}

/** Nguồn tin (collection NewsSource). */
export interface MockNewsSource {
  _id: string;
  name: string;
  url: string;
  rssUrl?: string;
  crawlConfig?: Record<string, unknown>;
  isActive: boolean;
}

/** Id cố định dạng ObjectId để các collection tham chiếu chéo được (vd raw → news). */
export const seedId = (prefix: string, index: number): string =>
  `${prefix}${index.toString(16).padStart(24 - prefix.length, '0')}`;

/** Ảnh minh hoạ ổn định theo seed (không cần asset local). */
export const thumbnailFor = (seed: string): string => `https://picsum.photos/seed/stnd-${seed}/640/400`;

const slugify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Tạo URL bài báo giả theo nguồn + tiêu đề. */
export const articleUrlFor = (sourceDomain: string, title: string): string =>
  `https://${sourceDomain}/${slugify(title)}.html`;

// ── Nguồn tin ────────────────────────────────────────────

export const newsSources: MockNewsSource[] = [
  {
    _id: seedId('66b1', 1),
    name: 'CafeLand',
    url: 'https://cafeland.vn/tin-tuc',
    rssUrl: 'https://cafeland.vn/rss/tin-tuc.rss',
    crawlConfig: { listSelector: '.list-news .item', titleSelector: 'h3 a', maxPages: 3 },
    isActive: true,
  },
  {
    _id: seedId('66b1', 2),
    name: 'VnExpress Bất động sản',
    url: 'https://vnexpress.net/bat-dong-san',
    rssUrl: 'https://vnexpress.net/rss/bat-dong-san.rss',
    crawlConfig: { listSelector: 'article.item-news', titleSelector: '.title-news a', maxPages: 2 },
    isActive: true,
  },
  {
    _id: seedId('66b1', 3),
    name: 'Batdongsan.com.vn',
    url: 'https://batdongsan.com.vn/tin-tuc',
    crawlConfig: { listSelector: '.re__news-item', titleSelector: 'a.re__news-title', maxPages: 2 },
    isActive: true,
  },
  {
    _id: seedId('66b1', 4),
    name: 'Báo Xây dựng',
    url: 'https://baoxaydung.vn/bat-dong-san',
    rssUrl: 'https://baoxaydung.vn/rss/bat-dong-san.rss',
    crawlConfig: { maxPages: 1 },
    isActive: true,
  },
  {
    _id: seedId('66b1', 5),
    name: 'Tuổi Trẻ Nhà đất',
    url: 'https://tuoitre.vn/nha-dat.htm',
    rssUrl: 'https://tuoitre.vn/rss/nha-dat.rss',
    crawlConfig: {},
    isActive: false,
  },
  {
    _id: seedId('66b1', 6),
    name: 'Reatimes',
    url: 'https://reatimes.vn/thi-truong',
    crawlConfig: { listSelector: '.story', titleSelector: '.story__title a' },
    isActive: true,
  },
  {
    _id: seedId('66b1', 7),
    name: 'Dân trí Bất động sản',
    url: 'https://dantri.com.vn/bat-dong-san.htm',
    rssUrl: 'https://dantri.com.vn/rss/bat-dong-san.rss',
    crawlConfig: {},
    isActive: false,
  },
];

const SOURCE_DOMAINS: Record<string, string> = {
  CafeLand: 'cafeland.vn',
  'VnExpress Bất động sản': 'vnexpress.net',
  'Batdongsan.com.vn': 'batdongsan.com.vn',
  'Báo Xây dựng': 'baoxaydung.vn',
  'Tuổi Trẻ Nhà đất': 'tuoitre.vn',
  Reatimes: 'reatimes.vn',
  'Dân trí Bất động sản': 'dantri.com.vn',
};

export const domainOfSource = (source: string): string => SOURCE_DOMAINS[source] ?? 'example.vn';

// ── Bài viết đã duyệt (NewsArticle) ──────────────────────

interface NewsSeed {
  title: string;
  summary: string;
  source: string;
  minutesAgo: number;
  status: string[];
}

const NEWS_SEEDS: NewsSeed[] = [
  {
    title: 'Giá căn hộ Thủ Đức tăng 8% quý III',
    summary:
      'Nguồn cung mới khan hiếm cùng hạ tầng Vành đai 3 tăng tốc khiến giá sơ cấp căn hộ tại TP Thủ Đức tăng 8% so với quý trước, chạm mốc 68 triệu đồng/m².',
    source: 'VnExpress Bất động sản',
    minutesAgo: 90,
    status: [],
  },
  {
    title: 'Hà Nội: Chung cư phía Tây tiếp tục dẫn dắt thanh khoản',
    summary:
      'Các dự án tại Nam Từ Liêm, Hà Đông chiếm hơn 60% lượng giao dịch căn hộ toàn thành phố trong tháng 9, giá bình quân đạt 62 triệu đồng/m².',
    source: 'CafeLand',
    minutesAgo: 240,
    status: ['CRAWLED'],
  },
  {
    title: 'Lãi suất cho vay mua nhà giảm về 7,5%/năm',
    summary:
      'Nhiều ngân hàng thương mại đồng loạt hạ lãi suất ưu đãi gói vay mua nhà ở xã hội và nhà ở thương mại, kỳ hạn cố định 24 tháng.',
    source: 'Batdongsan.com.vn',
    minutesAgo: 600,
    status: ['CRAWLED', 'POSTED_WP'],
  },
  {
    title: 'Đất nền vùng ven TP.HCM hồi phục nhẹ sau 2 năm trầm lắng',
    summary:
      'Thanh khoản đất nền tại Long An, Bình Dương tăng 15% so với cùng kỳ, chủ yếu ở phân khúc dưới 2 tỷ đồng có pháp lý hoàn chỉnh.',
    source: 'Reatimes',
    minutesAgo: 1_440,
    status: ['POSTED_WP'],
  },
  {
    title: 'Luật Đất đai 2024: Bảng giá đất mới tác động thế nào tới người mua nhà',
    summary:
      'Bảng giá đất điều chỉnh theo nguyên tắc thị trường giúp minh bạch nghĩa vụ tài chính nhưng có thể đẩy giá thành dự án mới tăng 10–20%.',
    source: 'Báo Xây dựng',
    minutesAgo: 2_000,
    status: [],
  },
  {
    title: 'Nhà ở xã hội: Hơn 30.000 căn được khởi công trong 9 tháng',
    summary:
      'Bộ Xây dựng cho biết cả nước đã khởi công 112 dự án nhà ở xã hội, tập trung tại Bắc Ninh, Hải Phòng, Bình Dương và Đà Nẵng.',
    source: 'VnExpress Bất động sản',
    minutesAgo: 2_880,
    status: ['ERROR'],
  },
  {
    title: 'Giá thuê văn phòng hạng A tại quận 1 đi ngang',
    summary:
      'Giá thuê văn phòng hạng A khu trung tâm duy trì quanh 45 USD/m²/tháng, tỷ lệ lấp đầy giảm nhẹ do nguồn cung mới từ Thủ Thiêm.',
    source: 'CafeLand',
    minutesAgo: 4_320,
    status: ['CRAWLED'],
  },
  {
    title: 'Bình Dương: Căn hộ dưới 40 triệu/m² chiếm 70% nguồn cung mới',
    summary:
      'Phân khúc căn hộ vừa túi tiền gần các khu công nghiệp tại Thuận An, Dĩ An tiếp tục hút người mua ở thực và nhà đầu tư cho thuê.',
    source: 'Batdongsan.com.vn',
    minutesAgo: 5_760,
    status: [],
  },
  {
    title: 'Đà Nẵng: Thị trường condotel chờ cơ chế cấp sổ hồng',
    summary:
      'Hơn 6.000 căn condotel tại Đà Nẵng chưa được cấp giấy chứng nhận, khiến thanh khoản phân khúc nghỉ dưỡng gần như đóng băng.',
    source: 'Tuổi Trẻ Nhà đất',
    minutesAgo: 7_200,
    status: ['CRAWLED', 'POSTED_WP'],
  },
  {
    title: 'Vành đai 3 TP.HCM thông xe kỹ thuật, bất động sản ven tuyến khởi sắc',
    summary:
      'Đoạn qua Thủ Đức – Nhơn Trạch thông xe kỹ thuật, giá rao bán nhà phố ven tuyến tăng 5–12% trong vòng 3 tháng.',
    source: 'Reatimes',
    minutesAgo: 8_640,
    status: [],
  },
  {
    title: 'Hải Phòng: Đất nền khu kinh tế Đình Vũ hút nhà đầu tư phía Bắc',
    summary:
      'Làn sóng FDI vào khu kinh tế Đình Vũ – Cát Hải kéo theo nhu cầu nhà ở chuyên gia, giá đất nền tăng 9% so với đầu năm.',
    source: 'Dân trí Bất động sản',
    minutesAgo: 10_080,
    status: ['CRAWLED'],
  },
  {
    title: 'Ngân hàng Nhà nước siết tín dụng bất động sản đầu cơ',
    summary:
      'Hệ số rủi ro cho các khoản vay kinh doanh bất động sản được nâng lên, trong khi tín dụng nhà ở cho người mua ở thực vẫn được ưu tiên.',
    source: 'VnExpress Bất động sản',
    minutesAgo: 12_960,
    status: ['POSTED_WP'],
  },
];

/** Nội dung markdown chi tiết cho bài viết (ghép từ tiêu đề + tóm tắt để trông tự nhiên). */
const buildArticleContent = (seed: NewsSeed): string =>
  [
    `## ${seed.title}`,
    '',
    seed.summary,
    '',
    '### Diễn biến thị trường',
    '',
    'Theo khảo sát của các đơn vị nghiên cứu thị trường, lượng giao dịch thành công trong tháng gần nhất tăng rõ rệt ở phân khúc có pháp lý minh bạch và tiến độ xây dựng đúng cam kết. Người mua ưu tiên dự án gần các trục giao thông trọng điểm.',
    '',
    '- Nguồn cung mới tập trung ở khu vực vùng ven và các đô thị vệ tinh.',
    '- Giá bán sơ cấp tăng nhẹ, giá thứ cấp đi ngang.',
    '- Tỷ lệ hấp thụ trung bình đạt 65–75% tại các dự án mở bán mới.',
    '',
    '### Nhận định chuyên gia',
    '',
    '> "Thị trường đang bước vào chu kỳ phục hồi có chọn lọc, dòng tiền chỉ chảy vào sản phẩm phục vụ nhu cầu ở thực." — Đại diện một đơn vị tư vấn bất động sản.',
    '',
    `_Nguồn: ${seed.source}_`,
  ].join('\n');

export const newsArticles: MockNewsArticle[] = NEWS_SEEDS.map((seed, index) => ({
  _id: seedId('66c1', index + 1),
  title: seed.title,
  summary: seed.summary,
  content: buildArticleContent(seed),
  source: seed.source,
  url: articleUrlFor(domainOfSource(seed.source), seed.title),
  thumbnailUrl: thumbnailFor(`news-${index + 1}`),
  publishDate: isoMinutesAgo(seed.minutesAgo + 60),
  createdAt: isoMinutesAgo(seed.minutesAgo),
  status: [...seed.status],
}));

/** Tạo NewsArticle mới từ raw article (dùng khi "Phân tích AI" / "Chuyển sang bài viết"). */
export const newsArticleFromRaw = (raw: MockRawArticle): MockNewsArticle => ({
  _id: mockObjectId(),
  title: raw.title,
  summary: raw.description,
  content: buildArticleContent({ title: raw.title, summary: raw.description, source: raw.source, minutesAgo: 0, status: [] }),
  source: raw.source,
  url: raw.url,
  thumbnailUrl: raw.thumbnailUrl,
  publishDate: raw.publishedAt,
  createdAt: new Date().toISOString(),
  status: [],
});

// ── Bài viết thô (RawArticle) ────────────────────────────

interface RawSeed {
  title: string;
  description: string;
  source: string;
  minutesAgo: number;
  /** Index (1-based) bài NewsArticle bị trùng, kèm điểm tương đồng. */
  duplicateOf?: { newsIndex: number; score: number };
  /** Index (1-based) bài NewsArticle đã lưu từ raw này. */
  savedAs?: number;
}

const RAW_SEEDS: RawSeed[] = [
  {
    title: 'Căn hộ Thủ Đức tăng giá mạnh nhờ hạ tầng',
    description: 'Giá căn hộ sơ cấp tại TP Thủ Đức tăng khoảng 8% trong quý III nhờ hạ tầng giao thông cải thiện.',
    source: 'CafeLand',
    minutesAgo: 35,
    duplicateOf: { newsIndex: 1, score: 0.93 },
  },
  {
    title: 'Giá căn hộ Thủ Đức tăng 8% quý III',
    description: 'Nguồn cung mới khan hiếm khiến giá căn hộ TP Thủ Đức tăng 8% so với quý trước.',
    source: 'VnExpress Bất động sản',
    minutesAgo: 95,
    savedAs: 1,
  },
  {
    title: 'Thị trường biệt thự nghỉ dưỡng Phú Quốc phân hóa mạnh',
    description: 'Biệt thự biển có vận hành cho thuê ổn định vẫn giữ giá, trong khi sản phẩm chưa hoàn thiện giảm 15–20%.',
    source: 'Reatimes',
    minutesAgo: 120,
  },
  {
    title: 'Long An: Hàng loạt dự án khu dân cư được gỡ vướng pháp lý',
    description: 'UBND tỉnh Long An phê duyệt điều chỉnh quy hoạch 1/500 cho 14 dự án khu dân cư tại Đức Hòa, Bến Lức.',
    source: 'Báo Xây dựng',
    minutesAgo: 180,
  },
  {
    title: 'Chung cư phía Tây Hà Nội dẫn dắt thanh khoản tháng 9',
    description: 'Nam Từ Liêm, Hà Đông chiếm hơn 60% lượng giao dịch căn hộ toàn thành phố.',
    source: 'Batdongsan.com.vn',
    minutesAgo: 260,
    duplicateOf: { newsIndex: 2, score: 0.88 },
  },
  {
    title: 'Giá nhà phố Gò Vấp vượt 200 triệu đồng/m²',
    description: 'Nhà phố mặt tiền đường Phan Văn Trị, Quang Trung ghi nhận mức giá rao bán trung bình 210 triệu đồng/m².',
    source: 'Batdongsan.com.vn',
    minutesAgo: 320,
  },
  {
    title: 'Nhà đầu tư Singapore rót 300 triệu USD vào bất động sản công nghiệp miền Bắc',
    description: 'Thương vụ M&A khu công nghiệp tại Bắc Ninh và Hưng Yên nâng tổng vốn ngoại vào phân khúc này lên mức cao nhất 5 năm.',
    source: 'VnExpress Bất động sản',
    minutesAgo: 480,
  },
  {
    title: 'Lãi suất vay mua nhà về quanh 7,5%/năm',
    description: 'Các ngân hàng đồng loạt giảm lãi suất ưu đãi cho vay mua nhà, cố định 24 tháng đầu.',
    source: 'CafeLand',
    minutesAgo: 610,
    duplicateOf: { newsIndex: 3, score: 0.81 },
  },
  {
    title: 'Khánh Hòa đấu giá thành công 45 lô đất tại Cam Lâm',
    description: 'Phiên đấu giá thu về hơn 120 tỷ đồng, giá trúng cao nhất gấp 2,3 lần giá khởi điểm.',
    source: 'Tuổi Trẻ Nhà đất',
    minutesAgo: 900,
  },
  {
    title: 'Đất nền vùng ven TP.HCM hồi phục nhẹ',
    description: 'Thanh khoản đất nền tại Long An, Bình Dương tăng 15% so với cùng kỳ năm trước.',
    source: 'Reatimes',
    minutesAgo: 1_450,
    savedAs: 4,
  },
  {
    title: 'TP.HCM đề xuất thí điểm nhà ở thương mại giá thấp',
    description: 'Sở Xây dựng TP.HCM đề xuất cơ chế ưu đãi tiền sử dụng đất cho dự án nhà ở thương mại giá dưới 30 triệu đồng/m².',
    source: 'Dân trí Bất động sản',
    minutesAgo: 2_100,
  },
  {
    title: 'Shophouse khối đế chung cư ế ẩm, chủ đầu tư giảm giá thuê',
    description: 'Tỷ lệ trống của shophouse khối đế tại các dự án quận 7, quận 9 cũ vượt 40%, giá thuê giảm 20–30%.',
    source: 'CafeLand',
    minutesAgo: 3_000,
  },
  {
    title: 'Bắc Ninh dẫn đầu nguồn cung nhà ở xã hội phía Bắc',
    description: 'Bắc Ninh có 32 dự án nhà ở xã hội với hơn 25.000 căn, chiếm gần 1/3 nguồn cung toàn miền Bắc.',
    source: 'Báo Xây dựng',
    minutesAgo: 4_400,
  },
  {
    title: 'Thị trường căn hộ cho thuê Hà Nội tăng giá 10%',
    description: 'Giá thuê căn hộ 2 phòng ngủ tại Cầu Giấy, Tây Hồ tăng khoảng 10% so với đầu năm do nhu cầu từ chuyên gia nước ngoài.',
    source: 'VnExpress Bất động sản',
    minutesAgo: 6_000,
  },
];

const urlHashOf = (url: string): string => {
  // Băm đơn giản (djb2) → hex, chỉ để có urlHash ổn định cho UI.
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) hash = (hash * 33) ^ url.charCodeAt(i);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const buildRawArticle = (seed: Omit<RawSeed, 'minutesAgo'>, id: string, publishedAt: string): MockRawArticle => {
  const url = articleUrlFor(domainOfSource(seed.source), seed.title);
  return {
    _id: id,
    urlHash: urlHashOf(url),
    title: seed.title,
    description: seed.description,
    source: seed.source,
    url,
    thumbnailUrl: thumbnailFor(`raw-${urlHashOf(url)}`),
    publishedAt,
    isDuplicate: Boolean(seed.duplicateOf),
    duplicateOfArticleId: seed.duplicateOf ? seedId('66c1', seed.duplicateOf.newsIndex) : null,
    duplicateScore: seed.duplicateOf?.score ?? null,
    savedArticleId: seed.savedAs ? seedId('66c1', seed.savedAs) : null,
  };
};

export const rawArticles: MockRawArticle[] = RAW_SEEDS.map((seed, index) =>
  buildRawArticle(seed, seedId('66d1', index + 1), isoMinutesAgo(seed.minutesAgo)),
);

/** Pool tin "mới" được thêm vào khi user bấm "Chạy quy trình thu thập". */
export const CRAWL_POOL: Omit<RawSeed, 'minutesAgo'>[] = [
  {
    title: 'Giá đất Hóc Môn tăng sau thông tin lên quận',
    description: 'Giá rao bán đất thổ cư tại Hóc Môn tăng 7–10% sau khi đề án thành lập quận được trình HĐND TP.',
    source: 'CafeLand',
  },
  {
    title: 'Quảng Ninh: Bất động sản Hạ Long thu hút dòng tiền nghỉ dưỡng',
    description: 'Nguồn cung căn hộ nghỉ dưỡng mới tại Bãi Cháy tăng mạnh, tỷ lệ hấp thụ đạt 55%.',
    source: 'Reatimes',
  },
  {
    title: 'Metro số 1 vận hành ổn định, giá thuê căn hộ ven tuyến tăng',
    description: 'Căn hộ trong bán kính 1km quanh các ga metro số 1 có giá thuê tăng trung bình 12% sau 6 tháng vận hành.',
    source: 'VnExpress Bất động sản',
  },
  {
    title: 'Cần Thơ phê duyệt quy hoạch khu đô thị mới Cái Răng',
    description: 'Khu đô thị quy mô 250ha dự kiến cung cấp 8.000 căn nhà ở, trong đó 20% là nhà ở xã hội.',
    source: 'Báo Xây dựng',
  },
  {
    title: 'Người trẻ Hà Nội chuyển hướng thuê nhà dài hạn',
    description: 'Khảo sát cho thấy 58% người dưới 30 tuổi tại Hà Nội chọn thuê nhà thay vì vay mua do giá căn hộ vượt khả năng chi trả.',
    source: 'Batdongsan.com.vn',
  },
];

// ── Lịch sử phân tích thị trường ─────────────────────────

/** Sinh báo cáo markdown phân tích thị trường (ngày + số bài để nội dung khác nhau mỗi lần). */
export const buildMarketAnalysisMarkdown = (dateLabel: string, articleCount: number): string =>
  [
    `# Báo cáo phân tích thị trường bất động sản — ${dateLabel}`,
    '',
    `_Tổng hợp từ ${articleCount} bài viết đã được AI lọc và xếp hạng._`,
    '',
    '## 1. Tổng quan',
    '',
    'Thị trường tiếp tục phục hồi có chọn lọc. Thanh khoản tập trung ở phân khúc căn hộ trung cấp và nhà ở xã hội; đất nền vùng ven bắt đầu có giao dịch trở lại nhưng chưa lan rộng.',
    '',
    '## 2. Diễn biến giá theo khu vực',
    '',
    '| Khu vực | Phân khúc | Giá bình quân | Biến động |',
    '|---|---|---|---|',
    '| TP Thủ Đức | Căn hộ | 68 triệu/m² | ▲ 8% |',
    '| Nam Từ Liêm (HN) | Căn hộ | 62 triệu/m² | ▲ 5% |',
    '| Bình Dương | Căn hộ | 38 triệu/m² | ▲ 3% |',
    '| Long An | Đất nền | 18 triệu/m² | ▲ 2% |',
    '| Đà Nẵng | Condotel | 45 triệu/m² | ▼ 4% |',
    '',
    '## 3. Yếu tố tác động chính',
    '',
    '- **Hạ tầng:** Vành đai 3 TP.HCM và metro số 1 tạo lực đẩy cho bất động sản phía Đông.',
    '- **Tín dụng:** Lãi suất vay mua nhà giảm về quanh 7,5%/năm, hỗ trợ người mua ở thực.',
    '- **Pháp lý:** Luật Đất đai 2024 giúp minh bạch nhưng làm tăng chi phí đầu vào dự án mới.',
    '',
    '## 4. Rủi ro cần theo dõi',
    '',
    '1. Bảng giá đất mới có thể đẩy giá bán sơ cấp tăng 10–20%.',
    '2. Phân khúc nghỉ dưỡng (condotel) vẫn vướng cơ chế cấp sổ.',
    '3. Tín dụng cho nhà đầu tư đầu cơ bị siết chặt hơn.',
    '',
    '## 5. Khuyến nghị',
    '',
    '- Người mua ở thực: ưu tiên căn hộ đã bàn giao, gần tuyến hạ tầng đã vận hành.',
    '- Nhà đầu tư: thận trọng với đất nền chưa có hạ tầng hoàn thiện; theo dõi bất động sản công nghiệp miền Bắc.',
  ].join('\n');

const historyDateLabel = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * 60_000).toLocaleDateString('vi-VN');

export const marketAnalysisHistory: MockMarketAnalysisHistory[] = [
  { minutesAgo: 180, count: 9, exported: true },
  { minutesAgo: 1_620, count: 12, exported: false },
  { minutesAgo: 3_060, count: 8, exported: true },
  { minutesAgo: 4_500, count: 11, exported: false },
  { minutesAgo: 5_940, count: 7, exported: false },
  { minutesAgo: 7_380, count: 10, exported: false },
  { minutesAgo: 8_820, count: 6, exported: false },
  { minutesAgo: 10_260, count: 9, exported: false },
].map(({ minutesAgo, count, exported }, index) => {
  const id = seedId('66e1', index + 1);
  return {
    _id: id,
    content: buildMarketAnalysisMarkdown(historyDateLabel(minutesAgo), count),
    articleIds: newsArticles.slice(0, count).map((article) => article._id),
    createdAt: isoMinutesAgo(minutesAgo),
    googleDriveExport: exported
      ? {
          documentId: `doc-${id}`,
          documentUrl: '#mock-doc',
          title: `Phân tích thị trường ${historyDateLabel(minutesAgo)}`,
          exportedAt: isoMinutesAgo(minutesAgo - 10),
        }
      : null,
  };
});
