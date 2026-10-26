import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import type { RefMaps } from '../customers/customer-refs.service';
import {
  AppointmentCustomerLean,
  AppointmentLean,
  toAppointmentResponse,
} from './appointment.mapper';

const userId = new Types.ObjectId();
const maps = {
  statuses: new Map(),
  projects: new Map(),
  users: new Map([[String(userId), 'Nhân viên A']]),
} as unknown as RefMaps;
const actor = {
  userId,
  role: UserRole.STAFF,
  displayName: 'A',
  teamId: null,
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
    );
    expect(response.customer.phoneMasked).toBe('0912 ••• 678');
    expect(JSON.stringify(response)).not.toContain('912345678');
  });

  it('khách thiếu SĐT hoặc đã ẩn danh: không ném lỗi, không lộ số', () => {
    expect(
      toAppointmentResponse(row, customer({}), maps, actor).customer
        .phoneMasked,
    ).toBe('');
    expect(
      toAppointmentResponse(
        row,
        customer({ phone: '+84912345678', anonymizedAt: new Date() }),
        maps,
        actor,
      ).customer.phoneMasked,
    ).toBe('••••');
  });
});
