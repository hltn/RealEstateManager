/**
 * FR-30 (T-59): MỘT hàm thuần dựng danh sách người thực hiện lịch hẹn + mặc định + kiểm hợp lệ.
 * Bảng ca dùng CÙNG tập với backend (`appointments-write.assignees.spec.ts`): careTeam ACTIVE ∪ Manager nhóm chủ ∪ người tạo khách.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_APPOINTMENT_ASSIGNEES,
  formatAssigneeNames,
  getDefaultAssigneeIds,
  listAssignableAssignees,
  validateAssigneeIds,
  type AssigneeSourceCustomer,
} from './appointmentAssignees';

const member = (id: string, role: 'PRIMARY' | 'MEMBER', isLocked?: boolean) => ({
  user: { id, displayName: `TV ${id}`, fullName: `TV ${id}`, jobTitle: '', ...(isLocked === undefined ? {} : { isLocked }) },
  role,
  addedAt: '2026-10-01T00:00:00.000Z',
  addedBy: { id: 'sys', displayName: 'Hệ thống' },
});
const owner = (userId: string, role = 'MANAGER') => ({ userId, fullName: `Chủ ${userId}`, role });

const customer = (overrides: Partial<AssigneeSourceCustomer> = {}): AssigneeSourceCustomer => ({ careTeam: [], ownerManagers: [], creator: null, ...overrides });
const ids = (source: AssigneeSourceCustomer) => listAssignableAssignees(source).map((option) => option.userId);

describe('listAssignableAssignees (FR-30)', () => {
  it('khách null hoặc rỗng cả ba nguồn: danh sách rỗng', () => {
    expect(listAssignableAssignees(null)).toEqual([]);
    expect(ids(customer())).toEqual([]);
  });

  it('gộp ba nguồn theo thứ tự careTeam, Manager nhóm chủ, người tạo', () => {
    const result = ids(customer({ careTeam: [member('p', 'PRIMARY'), member('m', 'MEMBER')], ownerManagers: [owner('mg')], creator: owner('cr', 'STAFF') }));
    expect(result).toEqual(['p', 'm', 'mg', 'cr']);
  });

  it('khử trùng theo userId: người ở nhiều nguồn chỉ xuất hiện một lần, giữ nguồn đầu', () => {
    const options = listAssignableAssignees(customer({ careTeam: [member('x', 'MEMBER')], ownerManagers: [owner('x'), owner('y')], creator: owner('y') }));
    expect(options.map((option) => option.userId)).toEqual(['x', 'y']);
    expect(options.map((option) => option.source)).toEqual(['MEMBER', 'OWNER_MANAGER']);
  });

  it('thành viên careTeam bị khóa (INACTIVE) không nằm trong danh sách', () => {
    expect(ids(customer({ careTeam: [member('p', 'PRIMARY'), member('lock', 'MEMBER', true)] }))).toEqual(['p']);
  });

  it('người tạo ngoài careTeam: Admin, Nhân viên, Quản lý đều chọn được (careTeam không chứa người tạo)', () => {
    for (const role of ['ADMIN', 'STAFF', 'MANAGER']) {
      expect(ids(customer({ careTeam: [member('p', 'PRIMARY')], creator: owner('cr', role) }))).toEqual(['p', 'cr']);
    }
  });

  it('nhãn: PRIMARY ghi phụ trách chính, manager ghi quản lý nhóm, creator ghi người tạo khách', () => {
    const options = listAssignableAssignees(customer({ careTeam: [member('p', 'PRIMARY')], ownerManagers: [owner('mg')], creator: owner('cr', 'STAFF') }));
    expect(options.map((option) => option.label)).toEqual(['TV p (phụ trách chính)', 'Chủ mg (quản lý nhóm)', 'Chủ cr (người tạo khách)']);
  });
});

describe('getDefaultAssigneeIds (FR-30)', () => {
  const full = customer({ careTeam: [member('p', 'PRIMARY'), member('m', 'MEMBER')], creator: owner('cr', 'STAFF') });

  it('người tạo lịch thuộc danh sách (kể cả là người tạo khách ngoài careTeam): chọn chính mình', () => {
    expect(getDefaultAssigneeIds(listAssignableAssignees(full), 'm')).toEqual(['m']);
    expect(getDefaultAssigneeIds(listAssignableAssignees(full), 'cr')).toEqual(['cr']);
  });

  it('không thuộc danh sách thì lấy phụ trách chính', () => {
    expect(getDefaultAssigneeIds(listAssignableAssignees(full), 'admin-ngoai')).toEqual(['p']);
  });

  it('Admin khác ngoài danh sách và chưa có PRIMARY: không điền sẵn (không tự chọn mình)', () => {
    expect(getDefaultAssigneeIds(listAssignableAssignees(customer({ careTeam: [member('m', 'MEMBER')] })), 'admin-ngoai')).toEqual([]);
    expect(getDefaultAssigneeIds([], 'admin-ngoai')).toEqual([]);
  });

  it('PRIMARY bị khóa thì không được dùng làm mặc định', () => {
    expect(getDefaultAssigneeIds(listAssignableAssignees(customer({ careTeam: [member('p', 'PRIMARY', true), member('m', 'MEMBER')] })), 'ai-do')).toEqual([]);
  });
});

describe('validateAssigneeIds (FR-30)', () => {
  const options = listAssignableAssignees(customer({ careTeam: [member('p', 'PRIMARY')], creator: owner('cr', 'STAFF') }));

  it('0 người bị chặn', () => {
    expect(validateAssigneeIds([], options)).toBe('Chọn ít nhất 1 người thực hiện.');
  });

  it('1..20 người hợp lệ; 21 người bị chặn', () => {
    const many = Array.from({ length: MAX_APPOINTMENT_ASSIGNEES + 1 }, (_, index) => member(`u${index}`, 'MEMBER'));
    const manyOptions = listAssignableAssignees(customer({ careTeam: many }));
    const manyIds = manyOptions.map((option) => option.userId);
    expect(validateAssigneeIds(manyIds.slice(0, 1), manyOptions)).toBeNull();
    expect(validateAssigneeIds(manyIds.slice(0, MAX_APPOINTMENT_ASSIGNEES), manyOptions)).toBeNull();
    expect(validateAssigneeIds(manyIds, manyOptions)).toBe(`Tối đa ${MAX_APPOINTMENT_ASSIGNEES} người thực hiện mỗi lịch hẹn.`);
  });

  it('người tạo khách ngoài careTeam là hợp lệ (bỏ chặn cứng "phải thuộc nhóm chăm sóc")', () => {
    expect(validateAssigneeIds(['cr'], options)).toBeNull();
    expect(validateAssigneeIds(['p', 'cr'], options)).toBeNull();
  });

  it('id ngoài danh sách (đã bị gỡ khỏi khách) bị chặn bằng câu riêng, không phải câu nhóm chăm sóc cũ', () => {
    const message = validateAssigneeIds(['la'], options);
    expect(message).toBe('Có người thực hiện không còn thuộc danh sách của khách này. Vui lòng chọn lại.');
    expect(message).not.toContain('nhóm chăm sóc');
  });
});

describe('formatAssigneeNames (FR-30)', () => {
  it('nhiều người nối bằng dấu phẩy theo thứ tự; một người; chưa có ai thì gạch ngang', () => {
    expect(formatAssigneeNames([{ displayName: 'Hạnh' }, { displayName: 'Bình' }])).toBe('Hạnh, Bình');
    expect(formatAssigneeNames([{ displayName: 'Hạnh' }])).toBe('Hạnh');
    expect(formatAssigneeNames([])).toBe('—');
  });
});
