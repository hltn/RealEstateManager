import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));

import { resetIdempotencyKeys } from './crmHttp';
import { fetchAppointments, postAppointment } from './schedulingApi';

const appointmentDto = {
  id: 'p1',
  customer: { id: 'c1', fullName: 'An', status: { id: 's', label: 'Mới', tone: 'brand' } },
  type: 'SITE_VISIT',
  title: '',
  startAt: 't',
  endAt: null,
  location: 'VP',
  note: '',
  project: { id: 'pr1', label: "Q'Terra" },
  assignee: { id: 'u1', displayName: 'Hạnh' },
  remindBeforeMinutes: [60],
  status: 'SCHEDULED',
  completedAt: null,
  outcome: null,
  createdBy: { id: 'u1', displayName: 'Hạnh' },
  version: 1,
  canDelete: true,
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ data: { data: appointmentDto } });
  resetIdempotencyKeys();
});

const sentBody = () => request.mock.calls[0][0].data as Record<string, unknown>;
const BASE = { customerId: 'c1', type: 'SITE_VISIT' as const, startAt: '2026-10-26T02:00:00.000Z' };

describe('postAppointment: dự án của lịch (G7)', () => {
  it('có dự án thì gửi projectId; "Không chọn" gửi null tường minh; không truyền thì không gửi trường này', async () => {
    await postAppointment({ ...BASE, projectId: 'pr1' });
    expect(sentBody()).toMatchObject({ projectId: 'pr1' });

    request.mockClear();
    await postAppointment({ ...BASE, projectId: null });
    expect(sentBody()).toHaveProperty('projectId', null);

    request.mockClear();
    await postAppointment(BASE);
    expect(sentBody()).not.toHaveProperty('projectId');
  });

  it('trả về lịch hẹn kèm tên dự án', async () => {
    expect((await postAppointment({ ...BASE, projectId: 'pr1' })).project).toEqual({ id: 'pr1', label: "Q'Terra" });
  });
});

describe('fetchAppointments: lịch đã hủy', () => {
  const listOf = (...statuses: string[]) => ({ data: { data: statuses.map((status, index) => ({ ...appointmentDto, id: `a${index}`, status })), meta: { total: statuses.length, page: 1, limit: 100, totalPages: 1 } } });

  it('mặc định bỏ lịch ĐÃ HỦY; hỏi riêng status=CANCELED thì giữ', async () => {
    request.mockResolvedValue(listOf('SCHEDULED', 'CANCELED', 'DONE'));
    expect((await fetchAppointments({})).map((appointment) => appointment.status)).toEqual(['SCHEDULED', 'DONE']);

    request.mockResolvedValue(listOf('CANCELED'));
    expect(await fetchAppointments({ status: 'CANCELED' })).toHaveLength(1);
  });
});
