import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
vi.mock('./crmHttp', () => ({ crmHttp: { list: (...args: unknown[]) => list(...args), get: vi.fn(), raw: vi.fn(), post: vi.fn() } }));

import { fetchCareTeamInvitees } from './careApi';
import * as careApi from './careApi';

const meta = { total: 1, page: 1, limit: 20, totalPages: 1 };

beforeEach(() => list.mockReset());

describe('fetchCareTeamInvitees (v1.0.5)', () => {
  it('gọi GET /crm/care-team-invitees với customerId, q đã trim, page mặc định 1', async () => {
    list.mockResolvedValue({ data: [], meta });
    await fetchCareTeamInvitees({ customerId: 'c1', q: '  An  ' });
    expect(list.mock.calls[0][0]).toBe('/crm/care-team-invitees');
    expect(list.mock.calls[0][1].params).toMatchObject({ customerId: 'c1', q: 'An', page: 1 });
  });

  it('q rỗng/chỉ khoảng trắng không gửi; thiếu customerId = thao tác hàng loạt', async () => {
    list.mockResolvedValue({ data: [], meta });
    await fetchCareTeamInvitees({ q: '   ', page: 3 });
    const { params } = list.mock.calls[0][1];
    expect(params.q).toBeUndefined();
    expect(params.customerId).toBeUndefined();
    expect(params.page).toBe(3);
  });

  it('map id, displayName, teamNames; thiếu teamNames -> mảng rỗng; giữ nguyên meta', async () => {
    list.mockResolvedValue({
      data: [
        { id: 'u1', displayName: 'Hạnh', teamNames: ['Nhóm 1', 'Nhóm 2'] },
        { id: 'u2', displayName: 'Thảo' },
      ],
      meta,
    });
    const result = await fetchCareTeamInvitees({});
    expect(result.data).toEqual([
      { id: 'u1', displayName: 'Hạnh', teamNames: ['Nhóm 1', 'Nhóm 2'] },
      { id: 'u2', displayName: 'Thảo', teamNames: [] },
    ]);
    expect(result.meta).toEqual(meta);
  });

  it('không còn export các hàm của luồng cũ (xin tham gia, đổi PRIMARY)', () => {
    expect(careApi).not.toHaveProperty('fetchCareTeamRequests');
    expect(careApi).not.toHaveProperty('putPrimary');
  });
});
