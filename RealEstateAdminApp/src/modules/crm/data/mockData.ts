/**
 * Dữ liệu mẫu của prototype CRM — dựng theo mô hình tài liệu 04 (`types/crm.ts`).
 *
 * Nhất quán với quy tắc nghiệp vụ: tiến độ KHÔNG lưu (suy ra từ 4 tiêu chí), tình trạng tham chiếu danh mục
 * (4 giá trị đúng tên), phân công theo userId với đúng 1 phụ trách chính, SĐT E.164, mọi thời điểm là ISO có năm.
 * Thời điểm được dựng TƯƠNG ĐỐI theo ngày tạo dữ liệu (`now`) để màn "Việc hôm nay" luôn có việc quá hạn / hôm nay / sắp tới.
 */
import { addDaysToDateKey, getVnTodayKey, vnDateTimeToIso } from '@crm/lib/dateTime';
import {
  buildCareTeam,
  buildSearchText,
  computeOccasions,
  computePersonaCompleteness,
  createEmptyCriteria,
  getPrimaryUserId,
} from '@crm/lib/customerRules';
import type { Appointment, CareLog, CriterionKey, Customer, PersonaValue } from '@crm/types/crm';
import { PERSONA_FIELDS } from './personaFields';
import { SEED_USERS } from './seedCatalogs';

type PersonaSeed = Record<string, string | string[] | boolean | [number, number]>;

interface CustomerSeed {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  statusId: string;
  sourceId?: string;
  projectIds?: string[];
  areaId?: string;
  tagIds?: string[];
  nationalId?: string;
  primaryId: string;
  memberIds?: string[];
  doneCriteria?: CriterionKey[];
  criteriaText?: Partial<Record<CriterionKey, string>>;
  persona?: PersonaSeed;
  notes?: string;
  createdDaysAgo: number;
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

const buildCustomer = (seed: CustomerSeed, at: AtFn): Customer => {
  const createdAt = at(-seed.createdDaysAgo, '09:00');
  const careTeam = buildCareTeam(seed.primaryId, seed.memberIds ?? [], seed.primaryId, createdAt);
  const criteria = createEmptyCriteria();
  (Object.keys(criteria) as CriterionKey[]).forEach((key) => {
    const isDone = seed.doneCriteria?.includes(key) ?? false;
    const description = seed.criteriaText?.[key] ?? '';
    const isTouched = isDone || Boolean(description);
    criteria[key] = { isDone, description, updatedAt: isTouched ? createdAt : null, updatedBy: isTouched ? seed.primaryId : null };
  });
  const persona = toPersonaValues(seed.persona ?? {}, seed.primaryId, createdAt);
  return {
    id: seed.id,
   
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
    searchText: buildSearchText({ fullName: seed.fullName, phone: seed.phone, email: seed.email }),
    createdAt,
    createdBy: seed.primaryId,
    createdVia: 'WEB',
    lastUpdatedAt: createdAt,
    lastUpdatedBy: seed.primaryId,
    version: 1,
  };
};

const userName = (userId: string): string => SEED_USERS.find((user) => user.id === userId)?.displayName ?? 'Hệ thống';

export interface SeedData {
  customers: Customer[];
  careLogs: CareLog[];
  appointments: Appointment[];
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
      statusId: 'st-interested', sourceId: 'src-facebook', projectIds: ['proj-1', 'proj-2'], areaId: 'area-q7', tagIds: ['tag-golf', 'tag-business-owner'],
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
      statusId: 'st-net', sourceId: 'src-website', projectIds: ['proj-2', 'proj-1'], areaId: 'area-nam-tu-liem', tagIds: ['tag-finance'],
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
      statusId: 'st-interested', sourceId: 'src-event', projectIds: ['proj-1'], areaId: 'area-thu-duc', tagIds: ['tag-golf', 'tag-food'],
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
      statusId: 'st-interested', sourceId: 'src-facebook', projectIds: ['proj-2'], areaId: 'area-q1', tagIds: ['tag-gym', 'tag-smarthome', 'tag-tech'],
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
      statusId: 'st-net', sourceId: 'src-referral', projectIds: ['proj-4'], areaId: 'area-gia-lam', tagIds: ['tag-nature', 'tag-manufacturing'],
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
      statusId: 'st-interested', sourceId: 'src-website', projectIds: ['proj-3'], areaId: 'area-van-giang', tagIds: ['tag-trading'],
      primaryId: 'hanh', doneCriteria: ['demand', 'finance'], createdDaysAgo: 30,
      criteriaText: { demand: 'Nhà phố để kinh doanh cà phê.', motivation: 'Đang khảo sát lượng khách qua lại.', finance: 'Sẵn 4 tỷ tiền mặt.' },
      persona: { occupation: 'Kinh doanh phụ tùng ô tô', decision_maker: 'Vợ chồng cùng duyệt', preferred_channel: 'Gặp mặt', salutation: 'Anh Quân', property_type: 'Nhà phố / Shophouse', budget: [6, 9] },
    },
    {
      id: 'CUST-007', fullName: 'Lê Hoàng Long', phone: '+84903568921', email: 'long.le@holding.vn',
      statusId: 'st-interested', sourceId: 'src-website', projectIds: ['proj-3', 'proj-1'], areaId: 'area-q7', tagIds: ['tag-yacht', 'tag-golf', 'tag-nature', 'tag-finance'],
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
      statusId: 'st-dropped', sourceId: 'src-telesales', projectIds: ['proj-6'], areaId: 'area-thu-dau-mot',
      primaryId: 'tuan', doneCriteria: ['demand'], createdDaysAgo: 45,
      criteriaText: { demand: 'Đất nền làm kho bãi.' },
      persona: { occupation: 'Chủ xưởng cơ khí khuôn mẫu', preferred_channel: 'Điện thoại', salutation: 'Anh Huy' },
      notes: 'Khách đổi kế hoạch, dồn vốn mở rộng xưởng sản xuất.',
    },
    {
      id: 'CUST-009', fullName: 'Hoàng Minh Đức', phone: '+84943112899', email: 'duc.hoangminh@example.com',
      statusId: 'st-net', sourceId: 'src-website', projectIds: ['proj-4'], areaId: 'area-long-bien',
      primaryId: 'quan', doneCriteria: ['demand', 'motivation', 'finance'], createdDaysAgo: 28,
      persona: { decision_maker: 'Vợ chồng cùng duyệt', preferred_channel: 'Điện thoại', salutation: 'Anh Đức', bedroom_type: '2PN (65-78m²)', budget: [4, 5], purchase_purposes: ['Ở thực'] },
    },
    {
      id: 'CUST-010', fullName: 'Phạm Thanh Mai', phone: '+84909432178', email: 'mai.pham@example.com',
      statusId: 'st-interested', sourceId: 'src-facebook', projectIds: ['proj-6'], areaId: 'area-thu-duc', tagIds: ['tag-pets'],
      primaryId: 'trang', doneCriteria: ['demand'], createdDaysAgo: 9,
      persona: { decision_maker: 'Khách tự quyết', preferred_channel: 'Zalo', salutation: 'Chị Mai', bedroom_type: '2PN (65-78m²)', budget: [4.5, 5.5], expected_purchase_time: 'Quý 1/2027' },
    },
    {
      id: 'CUST-011', fullName: 'Bùi Minh Phương', phone: '+84983221445', email: 'phuong.bui@example.com',
      statusId: 'st-not-contacted', sourceId: 'src-website', projectIds: ['proj-3'], areaId: 'area-gia-lam',
      primaryId: 'hanh', createdDaysAgo: 2,
    },
  ];

  const customers = seeds.map((seed) => buildCustomer(seed, at));
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
    ...seed,
  });

  const appointments: Appointment[] = [
    appointment({ id: 'APT-001', customerId: 'CUST-007', type: 'SITE_VISIT', title: "Xem nhà mẫu Q'Terra", startAt: at(0, '15:30'), location: "Văn phòng bán hàng Q'Terra, đường Mai Chí Thọ, TP. Thủ Đức", note: 'Khách quan tâm tầng cao view hồ. Chuẩn bị bảng tính dòng tiền đợt 2.', assigneeId: 'hanh', status: 'SCHEDULED' }),
    appointment({ id: 'APT-002', customerId: 'CUST-002', type: 'DEPOSIT_CONTRACT', title: 'Ký thỏa thuận đặt cọc', startAt: at(0, '14:30'), location: 'Văn phòng STND, Quận 1', note: 'Chuẩn bị phiếu thu và thỏa thuận đặt cọc.', assigneeId: 'minh', status: 'SCHEDULED', remindBeforeMinutes: [120] }),
    appointment({ id: 'APT-003', customerId: 'CUST-001', type: 'CALLBACK', title: 'Gọi lại tư vấn gói vay', startAt: at(0, '16:00'), location: 'Gọi điện / Zalo', note: 'Khách rảnh sau 16h, tư vấn gói hỗ trợ lãi suất.', assigneeId: 'hanh', status: 'SCHEDULED', remindBeforeMinutes: [30] }),
    appointment({ id: 'APT-004', customerId: 'CUST-006', type: 'SITE_VISIT', title: 'Dẫn khách xem nhà mẫu block B', startAt: at(1, '09:00'), location: 'Văn phòng Ecopark Grand', note: 'Trao đổi thêm phương án thanh toán giãn tiến độ.', assigneeId: 'hanh', status: 'SCHEDULED' }),
    appointment({ id: 'APT-005', customerId: 'CUST-004', type: 'SITE_VISIT', title: 'Xem căn mẫu cùng bố mẹ khách', startAt: at(2, '15:30'), location: 'Nhà mẫu The Privia, Bình Tân', note: 'Dẫn khách cùng bố mẹ xem căn 2PN mẫu và tiện ích.', assigneeId: 'hanh', status: 'SCHEDULED' }),
    appointment({ id: 'APT-006', customerId: 'CUST-010', type: 'MEETING', title: 'Tư vấn căn 2PN qua video call', startAt: at(0, '17:00'), location: 'Gọi video Zalo', note: 'Gửi video 3D trước để khách xem.', assigneeId: 'trang', status: 'SCHEDULED' }),
    appointment({ id: 'APT-007', customerId: 'CUST-003', type: 'MEETING', title: 'Gặp tư vấn phương án tài chính', startAt: at(-3, '10:00'), location: "Văn phòng Q'Terra", note: '', assigneeId: 'tung', status: 'DONE', completedAt: at(-3, '11:00') }),
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

  return { customers: enrichedCustomers, careLogs, appointments, nationalIds };
};
