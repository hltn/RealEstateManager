import { describe, expect, it } from 'vitest';
import { getSuggestedProjectId, isProjectEmphasizedType, listSelectableProjects, toCreateAppointmentInput, validateAppointmentForm } from './createAppointmentForm';
import type { AppointmentFormValues } from './createAppointmentForm';

const values = (date: string): AppointmentFormValues => ({
  customerId: 'CUST-001',
  type: 'CALLBACK',
  title: '',
  date,
  time: '10:00',
  location: '',
  note: '',
  projectId: '',
  assigneeId: 'hanh',
  remindBeforeMinutes: 60,
  smsZnsAuto: false,
  calendarSync: false,
});

describe('kiểm ngày quá khứ khi tạo lịch hẹn', () => {
  it('ngày trước hôm nay (giờ VN) bị từ chối; hôm nay và tương lai hợp lệ', () => {
    expect(validateAppointmentForm(values('2026-10-21'), null, '2026-10-22').date).toBe('Ngày hẹn không được ở quá khứ.');
    expect(validateAppointmentForm(values('2026-10-22'), null, '2026-10-22').date).toBeUndefined();
    expect(validateAppointmentForm(values('2026-10-23'), null, '2026-10-22').date).toBeUndefined();
  });
});

describe('dự án của lịch (G7)', () => {
  const project = (id: string, isActive = true, deletedAt: string | null = null) => ({ id, isActive, deletedAt }) as never;

  it('chỉ dự án đang hoạt động (chưa ngừng, chưa xóa mềm) chọn được cho lịch mới', () => {
    const selectable = listSelectableProjects([project('a'), project('b', false), project('c', true, '2026-10-01T00:00:00.000Z')]);
    expect(selectable.map((item) => item.id)).toEqual(['a']);
  });

  it('gợi ý: khách quan tâm đúng một dự án (đang hoạt động) thì chọn sẵn; nhiều dự án, không có, hoặc dự án đã ngừng thì không gợi ý', () => {
    const selectable = [{ id: 'a' }, { id: 'b' }];
    const customer = (ids: string[]) => ({ projects: ids.map((id) => ({ id, label: id })) });
    expect(getSuggestedProjectId(customer(['a']), selectable)).toBe('a');
    expect(getSuggestedProjectId(customer(['a', 'b']), selectable)).toBe('');
    expect(getSuggestedProjectId(customer([]), selectable)).toBe('');
    expect(getSuggestedProjectId(customer(['x']), selectable)).toBe(''); // dự án đã ngừng/không còn chọn được
    expect(getSuggestedProjectId(customer(['x', 'a']), selectable)).toBe('a'); // chỉ tính dự án còn chọn được
    expect(getSuggestedProjectId(null, selectable)).toBe('');
  });

  it('Xem nhà mẫu và Ký cọc được nhấn mạnh ô dự án, các loại khác thì không', () => {
    expect(isProjectEmphasizedType('SITE_VISIT')).toBe(true);
    expect(isProjectEmphasizedType('DEPOSIT_CONTRACT')).toBe(true);
    expect(isProjectEmphasizedType('CALLBACK')).toBe(false);
    expect(isProjectEmphasizedType('MEETING')).toBe(false);
    expect(isProjectEmphasizedType('OTHER')).toBe(false);
  });

  it('body tạo lịch: có dự án gửi id, "Không chọn" gửi null', () => {
    expect(toCreateAppointmentInput({ ...values('2026-10-23'), projectId: 'pr1' }).projectId).toBe('pr1');
    expect(toCreateAppointmentInput({ ...values('2026-10-23'), projectId: '' }).projectId).toBeNull();
  });
});
