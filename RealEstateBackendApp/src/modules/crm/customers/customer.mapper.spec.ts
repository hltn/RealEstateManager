import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CareRole } from './customer.constants';
import { toDetail, toListItem, toPhoneMasked } from './customer.mapper';
import type { RefMaps } from './customer-refs.service';
import type { CustomerLean } from './customers.repository';
import {
  buildProfileChanges,
  EMPTY_PROFILE,
} from './utils/customer-audit.util';

const refs: RefMaps = {
  statuses: new Map(),
  sources: new Map(),
  areas: new Map(),
  projects: new Map(),
  contactResults: new Map(),
  tags: new Map(),
  users: new Map(),
};
const me = new Types.ObjectId();
const doc = {
  _id: new Types.ObjectId(),
  fullName: 'Khách A',
  phone: '+84912345678',
  email: 'a@x.vn',
  statusId: new Types.ObjectId(),
  interestedProjectIds: [],
  careTeam: [
    { userId: me, role: CareRole.PRIMARY, addedBy: me, addedAt: new Date() },
  ],
  criteria: {},
  lastUpdatedAt: new Date(),
  createdAt: new Date(),
  searchText: 'nguyen\n\n0912345678',
  nationalId: { cipherText: 'zzz', iv: 'i', authTag: 't', keyVersion: 1 },
  nationalIdLast4: '8901',
  hasNationalId: true,
  dataConsent: {},
  __v: 3,
} as unknown as CustomerLean;
const actor = (role: UserRole) => ({
  userId: me,
  role,
  displayName: 'me',
  teamId: null,
  managedTeamIds: [],
});

describe('response không lộ dữ liệu nhạy cảm (Quality Gates 04 mục 10.2)', () => {
  it('list item và detail chỉ có phoneMasked; không có phone, searchText, bản mã CCCD', () => {
    const json = JSON.stringify([
      toListItem(doc, refs),
      toDetail(doc, refs, actor(UserRole.STAFF)),
    ]);
    expect(json).not.toContain('912345678');
    expect(json).not.toContain('searchText');
    expect(json).not.toContain('cipherText');
    expect(json).toContain('0912 ••• 678');
    expect(json).toContain('••••8901');
  });

  it('quyền hiển thị: phụ trách chính được xem CCCD/quản lý nhóm; thành viên thường thì không', () => {
    const asPrimary = toDetail(doc, refs, actor(UserRole.STAFF));
    expect(asPrimary.canRevealNationalId).toBe(true);
    expect(asPrimary.permissions).toMatchObject({
      canManageCareTeam: true,
      canChangePrimary: false,
      canDelete: false,
    });
    const asMember = toDetail(
      {
        ...doc,
        careTeam: [{ ...doc.careTeam[0], role: CareRole.MEMBER }],
      },
      refs,
      actor(UserRole.STAFF),
    );
    expect(asMember.canRevealNationalId).toBe(false);
    expect(asMember.permissions.canManageCareTeam).toBe(false);
    expect(
      toDetail(doc, refs, actor(UserRole.ADMIN)).permissions.canDelete,
    ).toBe(true);
  });

  it('khách đã ẩn danh: phoneMasked không dựa trên số giả', () => {
    expect(
      toListItem({ ...doc, anonymizedAt: new Date() }, refs).phoneMasked,
    ).toBe('••••');
  });

  it('toPhoneMasked: che số thường; thiếu SĐT (dữ liệu cũ) trả rỗng thay vì ném lỗi; ẩn danh ưu tiên hơn', () => {
    expect(toPhoneMasked({ phone: '+84912345678' })).toBe('0912 ••• 678');
    expect(toPhoneMasked({ phone: undefined })).toBe('');
    expect(
      toPhoneMasked({ phone: '+84912345678', anonymizedAt: new Date() }),
    ).toBe('••••');
  });
});

describe('audit changes của hồ sơ', () => {
  const after = { ...EMPTY_PROFILE, fullName: 'A', phone: '+84912345678' };

  it('lúc TẠO che SĐT (người chỉ xem lịch sử không đọc được số mà không có PHONE_VIEWED)', () => {
    const changes = buildProfileChanges(EMPTY_PROFILE, after, refs, true);
    expect(changes.find((c) => c.field === 'phone')?.to).toBe('0912 ••• 678');
  });

  it('lúc SỬA ghi SĐT cũ -> mới đầy đủ (quyết định #34)', () => {
    const changes = buildProfileChanges(
      after,
      { ...after, phone: '+84988888888' },
      refs,
    );
    expect(changes).toEqual([
      { field: 'phone', from: '+84912345678', to: '+84988888888' },
    ]);
  });
});

describe('thẻ trên list item', () => {
  const liveTag = new Types.ObjectId();
  const deletedTag = new Types.ObjectId();
  const withTags = {
    ...doc,
    tagIds: [liveTag, deletedTag],
  } as unknown as CustomerLean;
  const refsWithTag: RefMaps = {
    ...refs,
    tags: new Map([[String(liveTag), 'Golf']]),
  };

  it('chỉ hiện thẻ còn hoạt động (thẻ đã xóa/gộp không có nhãn thì bị bỏ qua)', () => {
    expect(toListItem(withTags, refsWithTag).tags).toEqual([
      { id: String(liveTag), label: 'Golf' },
    ]);
  });
});
