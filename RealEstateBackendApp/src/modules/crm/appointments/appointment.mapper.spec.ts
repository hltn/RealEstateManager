import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import type { CatalogRef, RefMaps } from '../customers/customer-refs.service';
import {
  AppointmentCustomerLean,
  AppointmentLean,
  toAppointmentResponse,
  toProjectRef,
} from './appointment.mapper';

const userId = new Types.ObjectId();
const maps = {
  statuses: new Map(),
  projects: new Map(),
  users: new Map([[String(userId), 'Nhân viên A']]),
} as unknown as RefMaps;
const noProjects = new Map<string, CatalogRef>();
const actor = {
  userId,
  role: UserRole.STAFF,
  roles: [UserRole.STAFF],
  displayName: 'A',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
};
const row = {
  _id: new Types.ObjectId(),
  type: 'VIEWING',
  title: '',
  startAt: new Date('2026-10-27T03:00:00.000Z'),
  endAt: null,
  location: '',
  note: '',
  assigneeId: userId,
  projectId: null,
  remindBeforeMinutes: [],
  status: 'SCHEDULED',
  completedAt: null,
  outcome: null,
  createdBy: userId,
  __v: 0,
} as unknown as AppointmentLean;
const customer = (
  extra: Partial<AppointmentCustomerLean>,
): AppointmentCustomerLean => ({
  _id: new Types.ObjectId(),
  fullName: 'Khách A',
  statusId: new Types.ObjectId(),
  ...extra,
});

describe('toAppointmentResponse: phoneMasked của khách', () => {
  it('trả SĐT đã che và không lộ số đầy đủ', () => {
    const response = toAppointmentResponse(
      row,
      customer({ phone: '+84912345678' }),
      maps,
      actor,
      noProjects,
    );
    expect(response.customer.phoneMasked).toBe('0912 ••• 678');
    expect(JSON.stringify(response)).not.toContain('912345678');
  });

  it('FR-04: khách thiếu SĐT hoặc đã ẩn danh: phoneMasked null, không ném lỗi, không lộ số', () => {
    expect(
      toAppointmentResponse(row, customer({}), maps, actor, noProjects).customer
        .phoneMasked,
    ).toBeNull();
    expect(
      toAppointmentResponse(
        row,
        customer({ phone: null }),
        maps,
        actor,
        noProjects,
      ).customer.phoneMasked,
    ).toBeNull();
    expect(
      toAppointmentResponse(
        row,
        customer({ phone: '+84912345678', anonymizedAt: new Date() }),
        maps,
        actor,
        noProjects,
      ).customer.phoneMasked,
    ).toBeNull();
  });
});

describe('toProjectRef / toAppointmentResponse.project: CatalogRefDto (FR-40)', () => {
  const projectId = new Types.ObjectId();
  const projects = new Map<string, CatalogRef>([
    [String(projectId), { id: projectId, code: 'QTERRA', label: 'Q Terra' }],
  ]);

  it('FR-40: lịch chưa gắn dự án => null', () => {
    expect(toProjectRef(null, null, projects)).toBeNull();
    expect(toProjectRef(undefined, undefined, projects)).toBeNull();
  });

  it('FR-40: trả { id, code, label }; code ưu tiên mã đã ghi kép trên lịch', () => {
    expect(toProjectRef(projectId, 'STORED', projects)).toEqual({
      id: String(projectId),
      code: 'STORED',
      label: 'Q Terra',
    });
  });

  it('FR-40 (dữ liệu cũ): lịch chưa có projectCode thì dịch code từ id, không lỗi', () => {
    expect(toProjectRef(projectId, undefined, projects)).toEqual({
      id: String(projectId),
      code: 'QTERRA',
      label: 'Q Terra',
    });
    expect(toProjectRef(projectId, null, projects)?.code).toBe('QTERRA');
  });

  it('FR-40 (biên): dự án đã bị xóa cứng khỏi danh mục => label và code rỗng, vẫn giữ id', () => {
    expect(toProjectRef(projectId, null, noProjects)).toEqual({
      id: String(projectId),
      code: '',
      label: '',
    });
  });

  it('FR-40: response lịch hẹn mang project dạng CatalogRefDto', () => {
    const response = toAppointmentResponse(
      { ...row, projectId, projectCode: 'QTERRA' },
      customer({}),
      maps,
      actor,
      projects,
    );
    expect(response.project).toEqual({
      id: String(projectId),
      code: 'QTERRA',
      label: 'Q Terra',
    });
  });
});
