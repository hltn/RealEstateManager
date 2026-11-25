/**
 * Dữ liệu mẫu của prototype CRM — dựng theo mô hình tài liệu 04 (`types/crm.ts`).
 *
 * Nhất quán với quy tắc nghiệp vụ: tiến độ KHÔNG lưu (suy ra từ 4 tiêu chí), tình trạng tham chiếu danh mục
 * (4 giá trị đúng tên), phân công theo userId với đúng 1 phụ trách chính, SĐT E.164, mọi thời điểm là ISO có năm.
 * Thời điểm được dựng TƯƠNG ĐỐI theo ngày tạo dữ liệu (`now`) để màn "Việc hôm nay" luôn có việc quá hạn / hôm nay / sắp tới.
 *
 * [Prototype] Bổ sung so với bản đầu: khách trạng thái "Bỏ" thuộc nhiều người phụ trách, khách CHƯA PHÂN CÔNG, khách thuộc nhóm của
 * tài khoản nhiều role/nhiều nhóm, khách đã XÓA MỀM (bình thường / đã ẩn danh hóa / xóa vĩnh viễn dở dang), đề nghị tham gia nhóm
 * chăm sóc (v1.0.5: đã bỏ luồng xin tham gia nên không còn đề nghị mẫu), khách CHƯA CÓ SĐT, khách TRÙNG SĐT với khách khác (cho phép từ v1.0.5), mã khách `KH-xxxxxx` theo thứ tự seed, lịch hẹn có dự án / đã hủy / đã hoàn thành kèm kết quả, thông báo trong app cho từng tài khoản mẫu.
 */
import { formatCustomerCode } from '@crm/lib/customerCode';
import { addDaysToDateKey, getVnTodayKey, vnDateTimeToIso } from '@crm/lib/dateTime';
import {
  buildCareTeam,
  buildSearchText,
  computeOccasions,
  computePersonaCompleteness,
  createEmptyCriteria,
  getPrimaryUserId,
} from '@crm/lib/customerRules';
import type { Appointment, CareLog, CareTeamRequest, CriterionKey, Customer, PersonaValue, StoredNotification } from '@crm/types/crm';
import { PERSONA_FIELDS } from './personaFields';
import { SEED_USERS } from './seedCatalogs';

type PersonaSeed = Record<string, string | string[] | boolean | [number, number]>;

interface CustomerSeed {
  id: string;
  fullName: string;
  /** `null` = khách chưa có SĐT (v1.0.5). */
  phone: string | null;
  email?: string;
  statusId: string;
  sourceId?: string;
  projectIds?: string[];
  areaId?: string;
  tagIds?: string[];
  nationalId?: string;
  /** Phụ trách chính; bỏ trống = khách CHƯA PHÂN CÔNG (nhóm chăm sóc rỗng, do `createdById` nhập). */
  primaryId?: string;
  /** Người nhập khách (mặc định = phụ trách chính). */
  createdById?: string;
  memberIds?: string[];
  doneCriteria?: CriterionKey[];
  criteriaText?: Partial<Record<CriterionKey, string>>;
  persona?: PersonaSeed;
  notes?: string;
  createdDaysAgo: number;
  /** Đã xóa mềm: số ngày trước, người xóa, lý do; `isAnonymized` = đã ẩn danh hóa; `isPurgeInProgress` = xóa vĩnh viễn dở dang. */
  deleted?: { daysAgo: number; byId: string; reason: string; isAnonymized?: boolean; isPurgeInProgress?: boolean };
}

type AtFn = (dayOffset: number, time: string) => string;

/** Giá trị seed -> PersonaValue theo kiểu trường (DATE nhận "YYYY-MM-DD", NUMBER_RANGE nhận [từ, đến] tỷ). */
const toPersonaValues = (seed: PersonaSeed, updatedBy: string, updatedAt: string): PersonaValue[] =>
  Object.entries(seed).map(([fieldKey, raw]) => {
    const definition = PERSONA_FIELDS.find((field) => field.key === fieldKey);
    const base = { fieldKey, source: 'CUSTOMER_SHARED' as const, updatedBy, updatedAt };
    switch (definition?.type) {
      case 'DATE':
        return { ...base, valueDate: String(raw) };
      case 'NUMBER_RANGE': {
        const [from, to] = raw as [number, number];
        return { ...base, valueNumber: from * 1_000_000_000, valueNumberTo: to * 1_000_000_000 };
      }
      case 'MULTI_SELECT':
        return { ...base, valueOptions: raw as string[] };
      case 'BOOLEAN':
        return { ...base, valueBoolean: Boolean(raw) };
      default:
        return { ...base, valueText: String(raw) };
    }
  });

/** `sequence` = số thứ tự trong danh sách seed (bắt đầu từ 1) -> mã khách `KH-000001`... */
const buildCustomer = (seed: CustomerSeed, at: AtFn, sequence: number): Customer => {
  const createdAt = at(-seed.createdDaysAgo, '09:00');
  const creatorId = seed.createdById ?? seed.primaryId ?? 'admin';
  const careTeam = seed.primaryId ? buildCareTeam(seed.primaryId, seed.memberIds ?? [], creatorId, createdAt) : [];
  const criteria = createEmptyCriteria();
  (Object.keys(criteria) as CriterionKey[]).forEach((key) => {
    const isDone = seed.doneCriteria?.includes(key) ?? false;
    const description = seed.criteriaText?.[key] ?? '';
    const isTouched = isDone || Boolean(description);
    criteria[key] = { isDone, description, updatedAt: isTouched ? createdAt : null, updatedBy: isTouched ? creatorId : null };
  });
  const persona = toPersonaValues(seed.persona ?? {}, creatorId, createdAt);
  return {
    id: seed.id,
   
    customerCode: formatCustomerCode(sequence),
    fullName: seed.fullName,
    phone: seed.phone,
    email: seed.email ?? '',
    statusId: seed.statusId,
    statusChangedAt: createdAt,
    sourceId: seed.sourceId ?? null,
    interestedProjectIds: seed.projectIds ?? [],
    areaId: seed.areaId ?? null,
    tagIds: seed.tagIds ?? [],
    nationalIdLast4: seed.nationalId ? seed.nationalId.slice(-4) : null,
    hasNationalId: Boolean(seed.nationalId),
    criteria,
    careTeam,
    primaryAssigneeId: getPrimaryUserId(careTeam),
    persona,
    occasions: computeOccasions(persona, PERSONA_FIELDS),
    personaCompleteness: computePersonaCompleteness(persona, PERSONA_FIELDS),
    shouldRemindOccasions: true,
    notes: seed.notes ?? '',
    lastCareLogAt: null,
    nextAppointmentAt: null,
    searchText: buildSearchText({ fullName: seed.fullName, phone: seed.phone, email: seed.email, customerCode: formatCustomerCode(sequence) }),
    createdAt,
    createdBy: creatorId,
    createdVia: 'WEB',
    lastUpdatedAt: createdAt,
    lastUpdatedBy: creatorId,
    version: 1,
    ...(seed.deleted
      ? {
          deletedAt: at(-seed.deleted.daysAgo, '10:30'),
          deletedBy: seed.deleted.byId,
          deleteReason: seed.deleted.isAnonymized ? null : seed.deleted.reason,
          anonymizedAt: seed.deleted.isAnonymized ? at(-seed.deleted.daysAgo, '10:35') : null,
          isPurgeInProgress: Boolean(seed.deleted.isPurgeInProgress),
          lastUpdatedAt: at(-seed.deleted.daysAgo, '10:30'),
          lastUpdatedBy: seed.deleted.byId,
        }
      : {}),
  };
};

const userName = (userId: string): string => SEED_USERS.find((user) => user.id === userId)?.displayName ?? 'Hệ thống';

export interface SeedData {
  customers: Customer[];
  careLogs: CareLog[];
  appointments: Appointment[];
  careTeamRequests: CareTeamRequest[];
  /** CCCD đầy đủ của dữ liệu mẫu -> nạp vào kho mô phỏng (không lưu trong hồ sơ). */
  nationalIds: Record<string, string>;
}

/** Dựng toàn bộ dữ liệu mẫu theo thời điểm `now`. */
export const buildSeedData = (now: Date = new Date()): SeedData => {
  const todayKey = getVnTodayKey(now);
  const at: AtFn = (dayOffset, time) => vnDateTimeToIso(addDaysToDateKey(todayKey, dayOffset), time);
  // Sinh nhật rơi vào 2 ngày tới để minh hoạ nhắc dịp đặc biệt (C13).
  const birthdaySoon = `1993-${addDaysToDateKey(todayKey, 2).slice(5)}`;

  const seeds: CustomerSeed[] = [
    {
      id: 'CUST-001', fullName: 'Nguyễn Văn An', phone: '+84912345678', email: 'nguyen.vanan@example.com',
      statusId: 'st-interested', sourceId: 'src-facebook', projectIds: ['proj-1', 'proj-2'], areaId: 'area-tp-ho-chi-minh', tagIds: ['tag-golf', 'tag-business-owner'],
      nationalId: '079092001234', primaryId: 'hanh', memberIds: ['thao'], doneCriteria: ['demand', 'finance'], createdDaysAgo: 25,
      criteriaText: {
        demand: 'Căn hộ 3PN, view sông, để ở và đầu tư lâu dài.',
        motivation: 'Đổi nhà để gần trường quốc tế cho con, đang chờ gia đình thống nhất.',
        finance: 'Ngân sách 5 - 7 tỷ, vốn tự có 60%, cần vay 40%.',
        timing: 'Dự kiến quyết định trong Quý 4/2026.',
      },
      persona: {
        birthday: '1984-11-15', hometown: 'Hà Nội', marital_status: 'Đã kết hôn', children: '2 con nhỏ, học trường quốc tế',
        occupation: 'Giám đốc công ty xuất nhập khẩu', business_field: 'Xuất nhập khẩu & Vận tải', decision_maker: 'Vợ chồng cùng duyệt',
        free_time_slot: '19:00 - 20:30', preferred_channel: 'Zalo', salutation: 'Anh An',
        property_type: 'Căn hộ chung cư', bedroom_type: '3PN (85-115m²)', purchase_purposes: ['Đầu tư lâu dài', 'Mua cho con'], budget: [5, 7],
        equity_ratio: '60% (cần vay 40%)', loan_support: true, expected_purchase_time: 'Quý 4/2026',
        criteria_priorities: ['View sông / công viên', 'Tầng cao', 'Gần trường quốc tế'], search_area: 'Quận 7, TP.HCM', specific_location: 'Phú Mỹ Hưng, ven sông',
      },
      notes: 'Muốn nhận thông tin dự án qua Zalo trước 20:00. Ưu tiên hướng Đông Nam, tầng trên 15.',
    },
    {
      id: 'CUST-002', fullName: 'Trần Thị Bích', phone: '+84988333112', email: 'bich.tran@investor.vn',
      statusId: 'st-net', sourceId: 'src-website', projectIds: ['proj-2', 'proj-1'], areaId: 'area-ha-noi', tagIds: ['tag-finance'],
      nationalId: '024088008721', primaryId: 'minh', doneCriteria: ['demand', 'motivation', 'finance'], createdDaysAgo: 40,
      criteriaText: { demand: 'Căn 2PN The Privia để cho thuê.', motivation: 'Có dòng tiền nhàn rỗi cần giải ngân trước quý 4.', finance: '100% tiền mặt.', timing: 'Đang chờ kiểm tra điều khoản bảo lãnh tiến độ.' },
      persona: {
        birthday: '1988-04-22', hometown: 'Nam Định', marital_status: 'Đã kết hôn', children: '1 bé 4 tuổi',
        occupation: 'Trưởng phòng Tài chính tập đoàn bán lẻ', business_field: 'Tài chính thương mại', decision_maker: 'Khách tự quyết',
        free_time_slot: '14:00 - 16:00', preferred_channel: 'Điện thoại', salutation: 'Chị Bích',
        property_type: 'Căn hộ chung cư', bedroom_type: '2PN (65-78m²)', purchase_purposes: ['Đầu tư cho thuê'], budget: [3.2, 3.8],
        equity_ratio: '100% tiền mặt', expected_purchase_time: 'Tháng 10/2026',
      },
    },
    {
      id: 'CUST-003', fullName: 'Lê Hoàng Nam', phone: '+84912888921', email: 'hoangnam.le@holding.vn',
      statusId: 'st-interested', sourceId: 'src-event', projectIds: ['proj-1'], areaId: 'area-tp-ho-chi-minh', tagIds: ['tag-golf', 'tag-food'],
      nationalId: '001085005589', primaryId: 'tung', memberIds: ['vy'], doneCriteria: ['demand', 'motivation', 'finance'], createdDaysAgo: 18,
      criteriaText: { demand: 'Căn 3PN view sông.', motivation: 'Chuyển nhà để con học gần trường.', finance: 'Tài chính khoảng 10 tỷ.', timing: 'Chờ mở bán chính thức giai đoạn 2.' },
      persona: {
        birthday: '1980-09-08', hometown: 'Đà Nẵng', marital_status: 'Đã kết hôn', children: '2 con',
        occupation: 'Chủ chuỗi nhà hàng', business_field: 'F&B & Dịch vụ', decision_maker: 'Vợ chồng cùng duyệt',
        free_time_slot: '15:00 - 17:30', preferred_channel: 'Gặp mặt', salutation: 'Anh Nam',
        property_type: 'Căn hộ chung cư', bedroom_type: '3PN (85-115m²)', budget: [8, 12], expected_purchase_time: 'Tháng 11/2026', search_area: 'Thảo Điền / An Phú',
      },
    },
    {
      id: 'CUST-004', fullName: 'Phạm Quỳnh Trang', phone: '+84977555562', email: 'quynhtrang@gmail.com',
      statusId: 'st-interested', sourceId: 'src-facebook', projectIds: ['proj-2'], areaId: 'area-tp-ho-chi-minh', tagIds: ['tag-gym', 'tag-smarthome', 'tag-tech'],
      nationalId: '079195004412', primaryId: 'hanh', doneCriteria: ['demand', 'motivation', 'finance', 'timing'], createdDaysAgo: 12,
      criteriaText: { demand: 'Căn 2PN hoàn thiện cơ bản.', motivation: 'Ra ở riêng.', finance: 'Đã được duyệt sơ bộ hạn mức vay.', timing: 'Muốn chốt ngay khi có căn tầng 12.' },
      persona: {
        birthday: birthdaySoon, hometown: 'Hải Phòng', marital_status: 'Độc thân', occupation: 'Chuyên gia Marketing Fintech', business_field: 'Công nghệ thông tin',
        decision_maker: 'Khách tự quyết', free_time_slot: '18:00 - 21:00', preferred_channel: 'Zalo', salutation: 'Chị Trang',
        property_type: 'Căn hộ chung cư', bedroom_type: '2PN (65-78m²)', purchase_purposes: ['Ở thực'], budget: [2.8, 3.5], loan_support: true, expected_purchase_time: 'Trong tháng này',
      },
    },
    {
      id: 'CUST-005', fullName: 'Đặng Tuấn Kiệt', phone: '+84934771650', email: 'tuankiet.dang@vinametal.com',
      statusId: 'st-net', sourceId: 'src-referral', projectIds: ['proj-4'], areaId: 'area-ha-noi', tagIds: ['tag-nature', 'tag-manufacturing'],
      nationalId: '001079006650', primaryId: 'quan', doneCriteria: ['demand', 'motivation', 'finance'], createdDaysAgo: 33,
      criteriaText: { demand: 'Biệt thự song lập.', motivation: 'Nâng cấp không gian sống cho gia đình 3 thế hệ.', finance: 'Vốn tự có 10 tỷ, vay thêm 6 tỷ.', timing: 'Đợi ngân hàng thẩm định tài sản thế chấp.' },
      persona: {
        birthday: '1979-06-10', hometown: 'Bắc Ninh', marital_status: 'Đã kết hôn', children: '3 con', occupation: 'Giám đốc nhà máy cơ khí',
        decision_maker: 'Tham khảo gia đình', preferred_channel: 'Điện thoại', salutation: 'Anh Kiệt',
        property_type: 'Biệt thự / Villa', purchase_purposes: ['Nghỉ dưỡng'], budget: [14, 18], loan_support: true,
      },
    },
    {
      id: 'CUST-006', fullName: 'Vũ Đình Quân', phone: '+84918654319', email: 'quan.vudinh@logistics.vn',
      statusId: 'st-interested', sourceId: 'src-website', projectIds: ['proj-3'], areaId: 'area-hung-yen', tagIds: ['tag-trading'],
      primaryId: 'hanh', doneCriteria: ['demand', 'finance'], createdDaysAgo: 30,
      criteriaText: { demand: 'Nhà phố để kinh doanh cà phê.', motivation: 'Đang khảo sát lượng khách qua lại.', finance: 'Sẵn 4 tỷ tiền mặt.' },
      persona: { occupation: 'Kinh doanh phụ tùng ô tô', decision_maker: 'Vợ chồng cùng duyệt', preferred_channel: 'Gặp mặt', salutation: 'Anh Quân', property_type: 'Nhà phố / Shophouse', budget: [6, 9] },
    },
    {
      id: 'CUST-007', fullName: 'Lê Hoàng Long', phone: '+84903568921', email: 'long.le@holding.vn',
      statusId: 'st-interested', sourceId: 'src-website', projectIds: ['proj-3', 'proj-1'], areaId: 'area-tp-ho-chi-minh', tagIds: ['tag-yacht', 'tag-golf', 'tag-nature', 'tag-finance'],
      primaryId: 'hanh', memberIds: ['minh'], doneCriteria: ['demand', 'motivation', 'finance'], createdDaysAgo: 20,
      criteriaText: { demand: 'Biệt thự song lập view hồ.', motivation: 'Không gian sống yên tĩnh cho bố mẹ và con nhỏ.', finance: 'Thanh toán bằng tiền mặt.', timing: 'Xem nhà mẫu trước khi chọn căn.' },
      persona: {
        birthday: '1982-09-19', hometown: 'Hà Nội', marital_status: 'Đã kết hôn', children: '3 con', occupation: 'Tổng giám đốc công ty đầu tư tài chính',
        decision_maker: 'Vợ chồng cùng duyệt', free_time_slot: '15:00 - 17:30', preferred_channel: 'Gặp mặt', salutation: 'Anh Long',
        property_type: 'Biệt thự / Villa', bedroom_type: '4PN', budget: [15, 28], expected_purchase_time: 'Quý 4/2026',
      },
    },
    {
      id: 'CUST-008', fullName: 'Đặng Quốc Huy', phone: '+84933221199', email: 'huy.dang@fmcg.com',
      statusId: 'st-dropped', sourceId: 'src-telesales', projectIds: ['proj-6'], areaId: 'area-tp-ho-chi-minh',
      primaryId: 'tuan', doneCriteria: ['demand'], createdDaysAgo: 45,
      criteriaText: { demand: 'Đất nền làm kho bãi.' },
      persona: { occupation: 'Chủ xưởng cơ khí khuôn mẫu', preferred_channel: 'Điện thoại', salutation: 'Anh Huy' },
      notes: 'Khách đổi kế hoạch, dồn vốn mở rộng xưởng sản xuất.',
    },
    {
      id: 'CUST-009', fullName: 'Hoàng Minh Đức', phone: '+84943112899', email: 'duc.hoangminh@example.com',
      statusId: 'st-net', sourceId: 'src-website', projectIds: ['proj-4'], areaId: 'area-ha-noi',
      primaryId: 'quan', doneCriteria: ['demand', 'motivation', 'finance'], createdDaysAgo: 28,
      persona: { decision_maker: 'Vợ chồng cùng duyệt', preferred_channel: 'Điện thoại', salutation: 'Anh Đức', bedroom_type: '2PN (65-78m²)', budget: [4, 5], purchase_purposes: ['Ở thực'] },
    },
    {
      id: 'CUST-010', fullName: 'Phạm Thanh Mai', phone: '+84909432178', email: 'mai.pham@example.com',
      statusId: 'st-interested', sourceId: 'src-facebook', projectIds: ['proj-6'], areaId: 'area-tp-ho-chi-minh', tagIds: ['tag-pets'],
      primaryId: 'trang', doneCriteria: ['demand'], createdDaysAgo: 9,
      persona: { decision_maker: 'Khách tự quyết', preferred_channel: 'Zalo', salutation: 'Chị Mai', bedroom_type: '2PN (65-78m²)', budget: [4.5, 5.5], expected_purchase_time: 'Quý 1/2027' },
    },
    {
      id: 'CUST-012', fullName: 'Ngô Thanh Sơn', phone: '+84907112233', email: 'son.ngo@example.com',
      statusId: 'st-dropped', sourceId: 'src-facebook', projectIds: ['proj-3'], areaId: 'area-hai-phong',
      primaryId: 'thao', memberIds: ['hanh'], doneCriteria: ['demand'], createdDaysAgo: 38,
      criteriaText: { demand: 'Nhà phố Ecopark để kinh doanh.' },
      persona: { occupation: 'Kinh doanh vật liệu xây dựng', preferred_channel: 'Zalo', salutation: 'Anh Sơn' },
      notes: 'Khách không còn nhu cầu mua trong năm nay.',
    },
    {
      id: 'CUST-013', fullName: 'Lý Thu Hà', phone: '+84905667788', email: 'ha.ly@example.com',
      statusId: 'st-dropped', sourceId: 'src-referral', projectIds: ['proj-2'], areaId: 'area-tp-ho-chi-minh',
      primaryId: 'tung', doneCriteria: [], createdDaysAgo: 50,
      persona: { preferred_channel: 'Điện thoại', salutation: 'Chị Hà' },
      notes: 'Số điện thoại đã đổi chủ, khách cũ không liên lạc được.',
    },
    {
      id: 'CUST-014', fullName: 'Trương Văn Hải', phone: '+84916778899', email: 'hai.truong@example.com',
      statusId: 'st-dropped', sourceId: 'src-event', projectIds: ['proj-1'], areaId: 'area-tp-ho-chi-minh',
      primaryId: 'huy', memberIds: ['khoa', 'lan'], doneCriteria: ['demand'], createdDaysAgo: 41,
      persona: { occupation: 'Kỹ sư xây dựng', preferred_channel: 'Điện thoại', salutation: 'Anh Hải' },
      notes: 'Khách thuộc nhiều nhóm chăm sóc (nhóm 1, 2, 3). Đã quyết định mua dự án khác.',
    },
    {
      id: 'CUST-015', fullName: 'Phan Quốc Bảo', phone: '+84932998877', email: '',
      statusId: 'st-not-contacted', sourceId: 'src-website', projectIds: ['proj-7'], areaId: 'area-dong-nai',
      createdById: 'admin', createdDaysAgo: 1,
      notes: 'Khách đăng ký từ website, chưa được phân người chăm sóc.',
    },
    {
      id: 'CUST-016', fullName: 'Đinh Hoài An', phone: '+84944556677', email: 'an.dinh@example.com',
      statusId: 'st-interested', sourceId: 'src-google', projectIds: ['proj-1', 'proj-5'], areaId: 'area-tp-ho-chi-minh', tagIds: ['tag-travel'],
      primaryId: 'huy', memberIds: ['khoa'], doneCriteria: ['demand', 'motivation'], createdDaysAgo: 14,
      criteriaText: { demand: 'Căn hộ 2PN view sông.', motivation: 'Chuẩn bị kết hôn.' },
      persona: { occupation: 'Bác sĩ', preferred_channel: 'Zalo', salutation: 'Chị An', property_type: 'Căn hộ chung cư', budget: [3, 4.5] },
    },
    {
      id: 'CUST-D01', fullName: 'Hồ Gia Bảo', phone: '+84901223344', email: 'bao.ho@example.com',
      statusId: 'st-dropped', sourceId: 'src-telesales', projectIds: ['proj-6'], areaId: 'area-tp-ho-chi-minh',
      primaryId: 'tuan', doneCriteria: ['demand'], createdDaysAgo: 80,
      criteriaText: { demand: 'Căn hộ 1PN cho thuê.' },
      deleted: { daysAgo: 3, byId: 'tuan', reason: 'Khách yêu cầu ngừng liên hệ qua điện thoại.' },
    },
    {
      id: 'CUST-D02', fullName: 'Nguyễn Văn Test', phone: '+84901000111', email: '',
      statusId: 'st-dropped', sourceId: 'src-website', areaId: 'area-ha-noi',
      primaryId: 'hanh', doneCriteria: [], createdDaysAgo: 120,
      deleted: { daysAgo: 20, byId: 'admin', reason: 'Dữ liệu nhập thử.', isAnonymized: true },
    },
    {
      id: 'CUST-D03', fullName: 'Lê Mỹ Duyên', phone: '+84901444555', email: 'duyen.le@example.com',
      statusId: 'st-dropped', sourceId: 'src-facebook', projectIds: ['proj-4'], areaId: 'area-ha-noi',
      primaryId: 'minh', doneCriteria: ['demand', 'finance'], createdDaysAgo: 95,
      deleted: { daysAgo: 9, byId: 'minh', reason: 'Khách trùng với hồ sơ khác, đã gộp thông tin.', isPurgeInProgress: true },
    },
    {
      id: 'CUST-011', fullName: 'Bùi Minh Phương', phone: '+84983221445', email: 'phuong.bui@example.com',
      statusId: 'st-not-contacted', sourceId: 'src-website', projectIds: ['proj-3'], areaId: 'area-ha-noi',
      primaryId: 'hanh', createdDaysAgo: 2,
    },
    // v1.0.5: khách CHƯA CÓ SĐT (không có nút gọi/Zalo/hiện số; "Hiện số" -> 409 CUSTOMER_PHONE_NOT_SET).
    {
      id: 'CUST-017', fullName: 'Mai Thị Hồng', phone: null, email: 'hong.mai@example.com',
      statusId: 'st-not-contacted', sourceId: 'src-facebook', areaId: 'area-tp-ho-chi-minh',
      primaryId: 'hanh', createdDaysAgo: 1,
    },
    // v1.0.5: TRÙNG SĐT với CUST-001 (hệ thống không còn chặn trùng; mỗi khách có mã riêng).
    {
      id: 'CUST-018', fullName: 'Nguyễn Văn An (hồ sơ khác)', phone: '+84912345678', email: '',
      statusId: 'st-not-contacted', sourceId: 'src-website', areaId: 'area-ha-noi',
      primaryId: 'tuan', createdDaysAgo: 1,
    },
  ];

  const customers = seeds.map((seed, index) => buildCustomer(seed, at, index + 1));
  const nationalIds = Object.fromEntries(seeds.filter((seed) => seed.nationalId).map((seed) => [seed.id, seed.nationalId as string]));

  const log = (
    id: string,
    customerId: string,
    authorId: string,
    occurredAt: string,
    contactChannel: CareLog['contactChannel'],
    content: string,
    extra: Partial<CareLog> = {},
  ): CareLog => ({
    id,
    customerId,
    authorId,
    authorName: userName(authorId),
    occurredAt,
    content,
    contactChannel,
    contactResultId: null,
    nextAction: null,
    source: 'MANUAL',
    ...extra,
  });

  // Mới nhất trước.
  const careLogs: CareLog[] = [
    log('LOG-011', 'CUST-007', 'hanh', at(0, '09:15'), 'ZALO', 'Nhắn Zalo xác nhận xe đón anh Long lúc 14:45 sang văn phòng xem sa bàn.'),
    log('LOG-010', 'CUST-004', 'hanh', at(0, '08:45'), 'OTHER', 'Đã chuẩn bị file phụ lục trang thiết bị bàn giao The Privia để chị Trang đối chiếu.', {
      nextAction: { suggestion: 'Hẹn chị Trang đối chiếu phụ lục hoàn thiện', dueAt: at(0, '16:00'), appointmentId: null },
    }),
    log('LOG-009', 'CUST-003', 'tung', at(-1, '10:00'), 'ZALO', "Gửi video flycam tiến độ thi công móng Q'Terra, khách đã xem.", {
      contactResultId: 'cr-comparing',
      nextAction: { suggestion: 'Gửi bảng so sánh 2 dự án khách đang cân nhắc', dueAt: at(5, '09:15'), appointmentId: null },
    }),
    log('LOG-001', 'CUST-001', 'hanh', at(-1, '14:15'), 'CALL', "Khách gọi hỏi thêm chính sách vay và tiến độ đóng tiền đợt 2 của Q'Terra, hẹn tuần tới đi xem sa bàn và nhà mẫu.", {
      contactResultId: 'cr-loan',
    }),
    log('LOG-012', 'CUST-009', 'quan', at(-2, '16:20'), 'CALL', 'Tư vấn sơ bộ chính sách thanh toán, khách muốn nghe kỹ phương án thanh toán sớm.', {
      nextAction: { suggestion: 'Gọi tư vấn chính sách thanh toán sớm', dueAt: at(0, '10:00'), appointmentId: null },
    }),
    log('LOG-014', 'CUST-011', 'system', at(-2, '09:05'), 'OTHER', 'Tiếp nhận khách từ form đăng ký nhận bảng giá trên website, phân cho Hạnh phụ trách.', {
      source: 'SYSTEM',
      nextAction: { suggestion: 'Gọi giới thiệu lần đầu và hỏi nhu cầu', dueAt: at(2, '14:00'), appointmentId: null },
    }),
    log('LOG-008', 'CUST-002', 'minh', at(-3, '16:00'), 'ZALO', 'Gửi bảng tính dòng tiền cho thuê dự kiến 14 triệu/tháng sau khi trừ phí quản lý.', {
      nextAction: { suggestion: 'Gửi bảng tính thanh toán đợt 2 (PDF qua Zalo) và gọi xác nhận', dueAt: at(-1, '14:00'), appointmentId: null },
    }),
    log('LOG-013', 'CUST-005', 'quan', at(-4, '11:30'), 'CALL', 'Khách muốn chuyển nhượng suất mua sớm, cần gặp trưởng phòng kinh doanh.', {
      nextAction: { suggestion: 'Sắp xếp buổi gặp với trưởng phòng kinh doanh', dueAt: at(3, '10:30'), appointmentId: null },
    }),
    log('LOG-003', 'CUST-001', 'thao', at(-5, '09:30'), 'ZALO', 'Nhắn Zalo gửi bảng tính dòng tiền và phương án vay hỗ trợ 40%. Khách đã xem, đang bàn với gia đình.', {
      contactResultId: 'cr-price',
      nextAction: { suggestion: 'Gửi thông tin mới của dự án, thử gọi lại buổi tối (sau 19h)', dueAt: at(-2, '19:00'), appointmentId: null },
    }),
    log('LOG-002', 'CUST-001', 'hanh', at(-6, '15:30'), 'CALL', 'Gọi điện, khách đang bận việc công ty, hẹn gọi lại sau 19h.', { contactResultId: 'cr-busy' }),
    log('LOG-004', 'CUST-001', 'hanh', at(-10, '16:00'), 'MEETING', "Gặp trực tiếp tại văn phòng Q'Terra, khách đi cùng vợ, thích căn 3PN tầng cao view sông.", { contactResultId: 'cr-site-visit' }),
    log('LOG-015', 'CUST-008', 'tuan', at(-20, '10:00'), 'CALL', 'Khách báo dừng kế hoạch mua, chuyển vốn mở rộng xưởng.', { contactResultId: 'cr-declined' }),
    log('LOG-005', 'CUST-001', 'tuan', at(-22, '10:20'), 'OTHER', 'Kiểm tra tình trạng quy hoạch và mặt bằng căn 3PN view sông giúp khách.'),
  ];

  type AppointmentSeed = Pick<Appointment, 'id' | 'customerId' | 'type' | 'title' | 'startAt' | 'location' | 'note' | 'assigneeId' | 'status'> &
    Partial<Appointment>;
  const appointment = (seed: AppointmentSeed): Appointment => ({
    endAt: null,
    remindBeforeMinutes: [60],
    completedAt: null,
    createdBy: seed.assigneeId,
    sourceCareLogId: null,
    smsZnsAuto: false,
    calendarSync: false,
    projectId: null,
    outcome: null,
    version: 1,
    ...seed,
  });

  const appointments: Appointment[] = [
    appointment({ id: 'APT-001', projectId: 'proj-1', customerId: 'CUST-007', type: 'SITE_VISIT', title: "Xem nhà mẫu Q'Terra", startAt: at(0, '15:30'), location: "Văn phòng bán hàng Q'Terra, đường Mai Chí Thọ, TP. Thủ Đức", note: 'Khách quan tâm tầng cao view hồ. Chuẩn bị bảng tính dòng tiền đợt 2.', assigneeId: 'hanh', status: 'SCHEDULED' }),
    appointment({ id: 'APT-002', customerId: 'CUST-002', type: 'DEPOSIT_CONTRACT', title: 'Ký thỏa thuận đặt cọc', startAt: at(0, '14:30'), location: 'Văn phòng STND, Quận 1', note: 'Chuẩn bị phiếu thu và thỏa thuận đặt cọc.', assigneeId: 'minh', status: 'SCHEDULED', remindBeforeMinutes: [120] }),
    appointment({ id: 'APT-003', customerId: 'CUST-001', type: 'CALLBACK', title: 'Gọi lại tư vấn gói vay', startAt: at(0, '16:00'), location: 'Gọi điện / Zalo', note: 'Khách rảnh sau 16h, tư vấn gói hỗ trợ lãi suất.', assigneeId: 'hanh', status: 'SCHEDULED', remindBeforeMinutes: [30] }),
    appointment({ id: 'APT-004', projectId: 'proj-3', customerId: 'CUST-006', type: 'SITE_VISIT', title: 'Dẫn khách xem nhà mẫu block B', startAt: at(1, '09:00'), location: 'Văn phòng Ecopark Grand', note: 'Trao đổi thêm phương án thanh toán giãn tiến độ.', assigneeId: 'hanh', status: 'SCHEDULED' }),
    appointment({ id: 'APT-005', projectId: 'proj-2', customerId: 'CUST-004', type: 'SITE_VISIT', title: 'Xem căn mẫu cùng bố mẹ khách', startAt: at(2, '15:30'), location: 'Nhà mẫu The Privia, Bình Tân', note: 'Dẫn khách cùng bố mẹ xem căn 2PN mẫu và tiện ích.', assigneeId: 'hanh', status: 'SCHEDULED' }),
    appointment({ id: 'APT-006', customerId: 'CUST-010', type: 'MEETING', title: 'Tư vấn căn 2PN qua video call', startAt: at(0, '17:00'), location: 'Gọi video Zalo', note: 'Gửi video 3D trước để khách xem.', assigneeId: 'trang', status: 'SCHEDULED' }),
    appointment({ id: 'APT-007', projectId: 'proj-1', customerId: 'CUST-003', type: 'MEETING', title: 'Gặp tư vấn phương án tài chính', startAt: at(-3, '10:00'), location: "Văn phòng Q'Terra", note: '', assigneeId: 'tung', status: 'DONE', completedAt: at(-3, '11:00'), outcome: 'Khách đồng ý phương án vay 40%, sẽ đưa vợ đi xem nhà mẫu.' }),
    appointment({ id: 'APT-008', customerId: 'CUST-016', projectId: 'proj-5', type: 'SITE_VISIT', title: 'Xem căn mẫu Lumiere Riverside', startAt: at(3, '10:00'), location: 'Nhà mẫu Lumiere Riverside, Thảo Điền', note: 'Khách muốn xem tầng 20 trở lên.', assigneeId: 'huy', status: 'SCHEDULED' }),
    appointment({ id: 'APT-009', customerId: 'CUST-001', type: 'MEETING', title: 'Gặp tại văn phòng ký hồ sơ vay', startAt: at(-2, '09:30'), location: 'Văn phòng STND, Quận 1', note: '', assigneeId: 'hanh', status: 'CANCELED', outcome: 'Khách báo bận việc đột xuất, hẹn lại sau.' }),
    appointment({ id: 'APT-010', customerId: 'CUST-016', type: 'CALLBACK', title: 'Gọi hỏi ý kiến gia đình', startAt: at(-1, '15:00'), location: 'Gọi điện / Zalo', note: 'Quá hạn chưa gọi.', assigneeId: 'khoa', status: 'SCHEDULED' }),
  ];

  // Phi chuẩn hoá giống backend: lần chăm sóc gần nhất + lịch hẹn sắp tới gần nhất + ngày cập nhật cuối.
  const nowValue = now.toISOString();
  const enrichedCustomers = customers.map((customer) => {
    const lastLog = careLogs.filter((item) => item.customerId === customer.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const nextAppointment = appointments
      .filter((item) => item.customerId === customer.id && item.status === 'SCHEDULED' && item.startAt >= nowValue)
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    const lastLogAt = lastLog?.occurredAt ?? null;
    const isLogNewer = lastLogAt !== null && lastLogAt > customer.lastUpdatedAt;
    return {
      ...customer,
      lastCareLogAt: lastLogAt,
      nextAppointmentAt: nextAppointment?.startAt ?? null,
      lastUpdatedAt: isLogNewer ? lastLogAt : customer.lastUpdatedAt,
      lastUpdatedBy: isLogNewer ? lastLog.authorId : customer.lastUpdatedBy,
    };
  });

  // v1.0.5: backend đã bỏ luồng xin tham gia nhóm chăm sóc -> không còn đề nghị mẫu (mảng giữ lại cho dữ liệu lưu cũ).
  const careTeamRequests: CareTeamRequest[] = [];

  return { customers: enrichedCustomers, careLogs, appointments, careTeamRequests, nationalIds };
};

/**
 * [Prototype] Thông báo mẫu trong app (hộp thông báo ở header + màn `/notifications`) cho các tài khoản mẫu: Quản trị, Quản lý, Nhân viên.
 * Dựng tương đối theo `now` để luôn "mới"; `deepLink` theo quy ước backend (`lib/notifications.ts` quy đổi sang route Web Admin).
 */
export const buildSeedNotifications = (now: Date = new Date()): StoredNotification[] => {
  const todayKey = getVnTodayKey(now);
  const at = (dayOffset: number, time: string): string => vnDateTimeToIso(addDaysToDateKey(todayKey, dayOffset), time);
  const item = (id: string, userId: string, type: string, title: string, body: string, createdAt: string, extra: Partial<StoredNotification> = {}): StoredNotification => ({
    id,
    userId,
    type,
    title,
    body,
    deepLink: extra.customerId ? `/crm/customers/${extra.customerId}` : '/crm/appointments',
    priority: 'NORMAL',
    isRead: false,
    createdAt,
    ...extra,
  });
  const forEveryone = (idPrefix: string, userIds: string[], build: (userId: string, id: string) => StoredNotification): StoredNotification[] => userIds.map((userId) => build(userId, `${idPrefix}-${userId}`));
  return [
    item('NTF-001', 'admin', 'SECURITY_ALERT', 'Cảnh báo xem số điện thoại', 'Một tài khoản đã xem số điện thoại khách vượt ngưỡng trong 1 giờ.', at(0, '08:10'), { priority: 'HIGH', deepLink: '/crm/audit-logs' }),
    item('NTF-002', 'admin', 'CARE_TEAM_JOIN_REQUESTED', 'Có đề nghị tham gia nhóm chăm sóc', 'Thảo đề nghị tham gia chăm sóc một khách của Nhóm Kinh doanh 2.', at(-1, '11:21'), { customerId: 'CUST-002' }),
    item('NTF-003', 'hanh', 'APPOINTMENT_DUE', 'Lịch hẹn hôm nay', "Xem nhà mẫu Q'Terra lúc 15:30 với khách Lê Hoàng Long.", at(0, '07:30'), { customerId: 'CUST-007', appointmentId: 'APT-001' }),
    item('NTF-004', 'hanh', 'STALE_CUSTOMER', 'Khách lâu chưa chăm sóc', 'Vũ Đình Quân đã quá 14 ngày chưa có nhật ký chăm sóc.', at(-1, '08:00'), { customerId: 'CUST-006', isRead: true }),
    item('NTF-005', 'hanh', 'CUSTOMER_OCCASION', 'Sinh nhật khách sắp tới', 'Phạm Quỳnh Trang có sinh nhật trong 2 ngày tới.', at(0, '07:30'), { customerId: 'CUST-004' }),
    item('NTF-006', 'minh', 'CARE_TEAM_JOIN_REQUESTED', 'Có đề nghị tham gia nhóm chăm sóc', 'Thảo đề nghị tham gia chăm sóc khách Trần Thị Bích.', at(-1, '11:21'), { customerId: 'CUST-002' }),
    item('NTF-007', 'minh', 'APPOINTMENT_DUE', 'Lịch hẹn hôm nay', 'Ký thỏa thuận đặt cọc lúc 14:30 với khách Trần Thị Bích.', at(0, '07:30'), { customerId: 'CUST-002', appointmentId: 'APT-002' }),
    item('NTF-008', 'thao', 'CUSTOMER_ASSIGNED', 'Bạn được phân khách mới', 'Nguyễn Văn An đã được thêm vào nhóm chăm sóc của bạn.', at(-5, '09:05'), { customerId: 'CUST-001', isRead: true }),
    item('NTF-009', 'thao', 'FOLLOW_UP_DUE', 'Việc cần làm quá hạn', 'Gửi thông tin mới của dự án cho khách Nguyễn Văn An.', at(-2, '19:05'), { customerId: 'CUST-001' }),
    item('NTF-010', 'huy', 'CUSTOMER_ASSIGNED', 'Bạn là phụ trách chính của khách', 'Đinh Hoài An được giao cho bạn phụ trách chính.', at(-14, '09:00'), { customerId: 'CUST-016', isRead: true }),
    item('NTF-011', 'huy', 'APPOINTMENT_DUE', 'Lịch hẹn sắp tới', 'Xem căn mẫu Lumiere Riverside sau 3 ngày với khách Đinh Hoài An.', at(0, '07:35'), { customerId: 'CUST-016', appointmentId: 'APT-008' }),
    ...forEveryone('NTF-W', ['admin', 'hanh', 'minh', 'thao', 'huy', 'khoa', 'lan'], (userId, id) =>
      item(id, userId, 'CUSTOMER_OCCASION', 'Chào mừng đến với CRM', 'Đây là thông báo mẫu của bản prototype thiết kế.', at(-3, '08:00'), { isRead: true, deepLink: '/crm/today' }),
    ),
  ];
};
