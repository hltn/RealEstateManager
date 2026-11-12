import { Types } from 'mongoose';
import type { RefMaps } from '../customer-refs.service';
import {
  buildProfileChanges,
  EMPTY_PROFILE,
  ProfileSnapshot,
} from './customer-audit.util';

const refs: RefMaps = {
  statuses: new Map(),
  sources: new Map(),
  areas: new Map(),
  projects: new Map(),
  contactResults: new Map(),
  tags: new Map(),
  users: new Map(),
  codes: {
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
  },
};

const profile = (overrides: Partial<ProfileSnapshot>): ProfileSnapshot => ({
  ...EMPTY_PROFILE,
  fullName: 'Khách A',
  ...overrides,
});

describe('buildProfileChanges với SĐT null (FR-01)', () => {
  it('FR-01: có SĐT -> xóa SĐT: from = số cũ, to = null (FE hiển thị "—")', () => {
    const changes = buildProfileChanges(
      profile({ phone: '+84912345678' }),
      profile({ phone: null }),
      refs,
    );
    expect(changes).toEqual([
      { field: 'phone', from: '+84912345678', to: null },
    ]);
  });

  it('FR-01: chưa có SĐT -> thêm SĐT: from = null, to = số mới', () => {
    const changes = buildProfileChanges(
      profile({ phone: null }),
      profile({ phone: '+84912345678' }),
      refs,
    );
    expect(changes).toEqual([
      { field: 'phone', from: null, to: '+84912345678' },
    ]);
  });

  it('FR-01: null -> null không sinh thay đổi', () => {
    expect(
      buildProfileChanges(
        profile({ phone: null }),
        profile({ phone: null }),
        refs,
      ),
    ).toEqual([]);
  });

  it('FR-01: lúc tạo (che SĐT) với phone null => không có dòng phone, không che số trên null', () => {
    const changes = buildProfileChanges(
      EMPTY_PROFILE,
      profile({ phone: null }),
      refs,
      true,
    );
    expect(changes.find((c) => c.field === 'phone')).toBeUndefined();
    expect(changes).toEqual([{ field: 'fullName', from: null, to: 'Khách A' }]);
  });

  it('FR-01: lúc tạo có SĐT => che số (không bằng số đầy đủ), from = null', () => {
    const changes = buildProfileChanges(
      EMPTY_PROFILE,
      profile({ phone: '+84912345678' }),
      refs,
      true,
    );
    const phone = changes.find((c) => c.field === 'phone');
    expect(phone?.from).toBeNull();
    expect(phone?.to).toEqual(expect.any(String));
    expect(phone?.to).not.toBe('+84912345678');
  });

  it('FR-01: đổi tên/nguồn khi SĐT vẫn null không kéo theo dòng phone', () => {
    const sourceId = new Types.ObjectId();
    const changes = buildProfileChanges(
      profile({ phone: null }),
      profile({ phone: null, fullName: 'Khách B', sourceId }),
      refs,
    );
    expect(changes.map((c) => c.field)).toEqual(['fullName', 'source']);
  });
});
