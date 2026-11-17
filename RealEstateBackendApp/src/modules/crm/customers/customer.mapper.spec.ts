import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ListGroup } from '../catalogs/catalog.enums';
import { CareRole } from './customer.constants';
import {
  LIST_PROJECTION,
  toDetail,
  toListItem,
  toPhoneMasked,
  toPurchasePurposes,
} from './customer.mapper';
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
  codes: {
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
  },
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
/** Khách do chính `me` tạo (FR-31: người tạo có quyền chủ khách). */
const ownDoc = { ...doc, createdBy: me } as unknown as CustomerLean;
const actor = (role: UserRole) => ({
  userId: me,
  role,
  roles: [role],
  displayName: 'me',
  teamId: null,
  teamIds: [],
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

  it('FR-31: người tạo được xem CCCD/quản lý nhóm/xóa; MEMBER không phải người tạo thì không có cờ nào', () => {
    const asCreator = toDetail(ownDoc, refs, actor(UserRole.STAFF));
    expect(asCreator.canRevealNationalId).toBe(true);
    expect(asCreator.permissions).toMatchObject({
      canManageCareTeam: true,
      canSetInitialPrimary: false,
      canDelete: true,
    });
    const notCreator = {
      ...ownDoc,
      createdBy: new Types.ObjectId(),
      careTeam: [{ ...doc.careTeam[0], role: CareRole.MEMBER }],
    } as unknown as CustomerLean;
    const asMember = toDetail(notCreator, refs, actor(UserRole.STAFF));
    expect(asMember.canRevealNationalId).toBe(false);
    expect(asMember.permissions.canManageCareTeam).toBe(false);
    expect(asMember.permissions.canDelete).toBe(false);
    expect(
      toDetail(notCreator, refs, actor(UserRole.ADMIN)).permissions.canDelete,
    ).toBe(true);
  });

  it('FR-31: PRIMARY không phải người tạo không có quyền chủ khách (CCCD, quản lý nhóm, xóa)', () => {
    const otherPrimary = {
      ...ownDoc,
      createdBy: new Types.ObjectId(),
    } as unknown as CustomerLean; // `me` là PRIMARY nhưng không phải người tạo
    const detail = toDetail(otherPrimary, refs, actor(UserRole.STAFF));
    expect(detail.canRevealNationalId).toBe(false);
    expect(detail.permissions).toMatchObject({
      canManageCareTeam: false,
      canDelete: false,
    });
  });

  it('FR-31: Manager thuộc nhóm chủ (managerIds do buildOwnerRefs nạp) có quyền chủ khách nhưng KHÔNG xóa được khách của nhân viên; Manager khác nhóm thì không có gì', () => {
    const foreign = {
      ...doc,
      createdBy: new Types.ObjectId(),
      careTeam: [],
    } as unknown as CustomerLean;
    const asOwnerManager = toDetail(foreign, refs, actor(UserRole.MANAGER), {
      ownerManagers: [],
      creator: null,
      managerIds: [me],
    });
    expect(asOwnerManager.canRevealNationalId).toBe(true);
    expect(asOwnerManager.permissions).toMatchObject({
      canManageCareTeam: true,
      canSetInitialPrimary: true,
      canDelete: false,
    });
    const asOtherManager = toDetail(foreign, refs, actor(UserRole.MANAGER), {
      ownerManagers: [],
      creator: null,
      managerIds: [new Types.ObjectId()],
    });
    expect(asOtherManager.canRevealNationalId).toBe(false);
    expect(asOtherManager.permissions).toMatchObject({
      canManageCareTeam: false,
      canSetInitialPrimary: false,
      canDelete: false,
    });
  });

  it('FR-11: permissions.canSetInitialPrimary chỉ true khi Admin/Manager và careTeam rỗng; không còn canChangePrimary', () => {
    const empty = { ...doc, careTeam: [] } as unknown as CustomerLean;
    // FR-31: Manager cần là Manager nhóm chủ (`managerIds`) mới đặt được PRIMARY đầu tiên.
    const flag = (role: UserRole, d: CustomerLean) =>
      toDetail(d, refs, actor(role), {
        ownerManagers: [],
        creator: null,
        managerIds: [me],
      }).permissions.canSetInitialPrimary;

    expect(flag(UserRole.ADMIN, empty)).toBe(true);
    expect(flag(UserRole.MANAGER, empty)).toBe(true);
    expect(flag(UserRole.STAFF, empty)).toBe(false);
    // Đã có PRIMARY thì khóa, kể cả Admin/Manager.
    expect(flag(UserRole.ADMIN, doc)).toBe(false);
    expect(flag(UserRole.MANAGER, doc)).toBe(false);
    expect(
      toDetail(doc, refs, actor(UserRole.ADMIN)).permissions,
    ).not.toHaveProperty('canChangePrimary');
  });

  it('FR-31: permissions.canDelete theo đúng luật xóa thật: chỉ Admin hoặc người tạo, KHÔNG phụ thuộc tình trạng khách và không mở cho Manager nhóm chủ', () => {
    const withStatus = (listGroup: ListGroup): RefMaps => ({
      ...refs,
      statuses: new Map([
        [
          String(doc.statusId),
          {
            id: String(doc.statusId),
            code: 'S',
            label: 'S',
            listGroup,
            color: null,
          },
        ],
      ]),
    });
    const canDelete = (role: UserRole, group: ListGroup, d = ownDoc, a = {}) =>
      toDetail(d, withStatus(group), { ...actor(role), ...a }).permissions
        .canDelete;
    // Người tạo xóa được ở mọi tình trạng (D9).
    expect(canDelete(UserRole.STAFF, ListGroup.DROPPED)).toBe(true);
    expect(canDelete(UserRole.STAFF, ListGroup.INTERESTED)).toBe(true);
    // Manager nhóm chủ mà không phải người tạo: không xóa được, kể cả khách "Bỏ".
    const team = new Types.ObjectId();
    const staffCustomer = {
      ...ownDoc,
      createdBy: new Types.ObjectId(),
      teamIds: [team],
    } as unknown as CustomerLean;
    expect(
      canDelete(UserRole.MANAGER, ListGroup.DROPPED, staffCustomer, {
        managedTeamIds: [team],
      }),
    ).toBe(false);
    expect(canDelete(UserRole.ADMIN, ListGroup.INTERESTED, staffCustomer)).toBe(
      true,
    );
  });

  it('FR-04/FR-06: khách đã ẩn danh (phone null): list item và detail trả phoneMasked null, không dựa trên số giả', () => {
    const anonymized = { ...doc, phone: null, anonymizedAt: new Date() };
    expect(toListItem(anonymized, refs).phoneMasked).toBeNull();
    expect(
      toDetail(anonymized, refs, actor(UserRole.ADMIN)).phoneMasked,
    ).toBeNull();
  });

  it('FR-04: khách không có SĐT (phone null): list item và detail trả phoneMasked null, không ném lỗi', () => {
    expect(toListItem({ ...doc, phone: null }, refs).phoneMasked).toBeNull();
    expect(
      toDetail({ ...doc, phone: null }, refs, actor(UserRole.ADMIN))
        .phoneMasked,
    ).toBeNull();
  });

  it('FR-04: toPhoneMasked che số thường; null/undefined/rỗng => null; ẩn danh => null kể cả khi còn số', () => {
    expect(toPhoneMasked({ phone: '+84912345678' })).toBe('0912 ••• 678');
    expect(toPhoneMasked({ phone: null })).toBeNull();
    expect(toPhoneMasked({ phone: undefined })).toBeNull();
    expect(toPhoneMasked({ phone: '' })).toBeNull();
    expect(
      toPhoneMasked({ phone: '+84912345678', anonymizedAt: new Date() }),
    ).toBeNull();
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

describe('FR-40: CatalogRefDto và audit fromCode/toCode', () => {
  const sourceId = new Types.ObjectId();
  const areaId = new Types.ObjectId();
  const projectId = new Types.ObjectId();
  const orphanProjectId = new Types.ObjectId();
  const refsWithCodes: RefMaps = {
    ...refs,
    sources: new Map([[String(sourceId), 'Facebook Ads']]),
    areas: new Map([[String(areaId), 'Hà Nội']]),
    projects: new Map([[String(projectId), 'Vinhomes Ocean Park']]),
    codes: {
      sources: new Map([[String(sourceId), 'FACEBOOK_ADS']]),
      areas: new Map([[String(areaId), 'HA_NOI']]),
      projects: new Map([[String(projectId), 'VINOP']]),
      contactResults: new Map(),
    },
  };
  const withRefs = {
    ...doc,
    sourceId,
    areaId,
    interestedProjectIds: [projectId],
  } as unknown as CustomerLean;

  it('FR-40: source/area/projects trả { id, code, label } với code dịch từ id', () => {
    const item = toListItem(withRefs, refsWithCodes);
    expect(item.source).toEqual({
      id: String(sourceId),
      code: 'FACEBOOK_ADS',
      label: 'Facebook Ads',
    });
    expect(item.area).toEqual({
      id: String(areaId),
      code: 'HA_NOI',
      label: 'Hà Nội',
    });
    expect(item.projects).toEqual([
      { id: String(projectId), code: 'VINOP', label: 'Vinhomes Ocean Park' },
    ]);
  });

  it('FR-40: đổi nhãn danh mục không đổi code trong response', () => {
    const renamed: RefMaps = {
      ...refsWithCodes,
      sources: new Map([[String(sourceId), 'Facebook (đã đổi tên)']]),
    };
    const source = toListItem(withRefs, renamed).source;
    expect(source?.label).toBe('Facebook (đã đổi tên)');
    expect(source?.code).toBe('FACEBOOK_ADS');
  });

  it('FR-40: bản ghi chưa lưu code vẫn dựng được bằng cách dịch từ id; danh mục bị xóa cứng thì code rơi về mã đã lưu hoặc rỗng, không lỗi', () => {
    const orphan = {
      ...withRefs,
      sourceId: new Types.ObjectId(),
      sourceCode: 'DA_LUU',
      areaId: new Types.ObjectId(),
      interestedProjectIds: [projectId, orphanProjectId],
    } as unknown as CustomerLean;
    const item = toListItem(orphan, refsWithCodes);
    expect(item.source).toMatchObject({ code: 'DA_LUU', label: '' });
    expect(item.area).toMatchObject({ code: '', label: '' });
    expect(item.projects.map((project) => project.code)).toEqual(['VINOP', '']);
  });

  it('FR-40: audit đổi nguồn/khu vực/dự án có fromCode/toCode cạnh nhãn', () => {
    const before = {
      ...EMPTY_PROFILE,
      sourceId,
      areaId,
      interestedProjectIds: [projectId],
    };
    const changes = buildProfileChanges(before, EMPTY_PROFILE, refsWithCodes);
    expect(changes).toEqual([
      {
        field: 'source',
        from: 'Facebook Ads',
        to: null,
        fromCode: 'FACEBOOK_ADS',
        toCode: null,
      },
      {
        field: 'area',
        from: 'Hà Nội',
        to: null,
        fromCode: 'HA_NOI',
        toCode: null,
      },
      {
        field: 'projects',
        from: ['Vinhomes Ocean Park'],
        to: [],
        fromCode: ['VINOP'],
        toCode: [],
      },
    ]);
  });

  it('FR-40: audit đổi nhãn không đổi code: cùng id thì không phát sinh thay đổi', () => {
    const same = { ...EMPTY_PROFILE, sourceId };
    const renamed: RefMaps = {
      ...refsWithCodes,
      sources: new Map([[String(sourceId), 'Tên mới']]),
    };
    expect(buildProfileChanges(same, same, renamed)).toEqual([]);
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

describe('purchasePurposes của list item (Mục đích mua)', () => {
  const entry = (fieldKey: string, valueOptions?: string[]) => ({
    fieldKey,
    valueOptions,
    valueText: 'nhạy cảm',
    source: 'MANUAL',
    updatedBy: me,
    updatedAt: new Date(),
  });
  const withPersona = (persona: unknown, extra = {}) =>
    ({ ...doc, persona, ...extra }) as unknown as CustomerLean;

  it('trả mã lựa chọn theo thứ tự đã lưu', () => {
    const item = toListItem(
      withPersona([
        entry('occupation'),
        entry('purchase_purposes', ['LIVING', 'INVEST_RENT']),
      ]),
      refs,
    );
    expect(item.purchasePurposes).toEqual(['LIVING', 'INVEST_RENT']);
  });

  it('chưa có persona, persona rỗng hoặc chưa nhập trường này: mảng rỗng', () => {
    expect(toListItem(doc, refs).purchasePurposes).toEqual([]);
    expect(toListItem(withPersona([]), refs).purchasePurposes).toEqual([]);
    expect(
      toListItem(withPersona([entry('occupation')]), refs).purchasePurposes,
    ).toEqual([]);
    expect(
      toListItem(withPersona([entry('purchase_purposes')]), refs)
        .purchasePurposes,
    ).toEqual([]);
  });

  it('giữ giá trị của lựa chọn đã tắt (không tra cấu hình); bỏ phần tử rác và trùng', () => {
    expect(
      toPurchasePurposes(
        withPersona([
          entry('purchase_purposes', ['OLD_OPTION', 'LIVING', 'LIVING', '']),
        ]),
      ),
    ).toEqual(['OLD_OPTION', 'LIVING']);
  });

  it('dữ liệu cũ lưu valueOptions sai kiểu (chuỗi, object, null): trả mảng rỗng, không ném lỗi', () => {
    for (const bad of ['LIVING', { 0: 'LIVING' }, null, 7]) {
      const badDoc = withPersona([
        { ...entry('purchase_purposes'), valueOptions: bad },
      ]);
      expect(() => toListItem(badDoc, refs)).not.toThrow();
      expect(toPurchasePurposes(badDoc)).toEqual([]);
    }
  });

  it('khách ẩn danh: rỗng dù còn dữ liệu persona', () => {
    const item = toListItem(
      withPersona([entry('purchase_purposes', ['LIVING'])], {
        anonymizedAt: new Date(),
      }),
      refs,
    );
    expect(item.purchasePurposes).toEqual([]);
  });

  it('không lộ phần tử persona nào khác ra response; detail dùng chung cùng giá trị', () => {
    const full = withPersona([
      entry('purchase_purposes', ['RESORT']),
      { ...entry('occupation'), valueText: 'BAC_SI_BI_MAT' },
    ]);
    const json = JSON.stringify([
      toListItem(full, refs),
      toDetail(full, refs, actor(UserRole.ADMIN)),
    ]);
    expect(json).not.toContain('BAC_SI_BI_MAT');
    expect(json).not.toContain('nhạy cảm');
    expect(json).not.toContain('"persona"');
    expect(
      toDetail(full, refs, actor(UserRole.ADMIN)).purchasePurposes,
    ).toEqual(['RESORT']);
  });

  it('LIST_PROJECTION chỉ đọc đúng phần tử purchase_purposes của persona, không lấy cả mảng', () => {
    expect(LIST_PROJECTION.persona).toEqual({
      $elemMatch: { fieldKey: 'purchase_purposes' },
    });
    expect(LIST_PROJECTION).toMatchObject({ fullName: 1, anonymizedAt: 1 });
    expect(LIST_PROJECTION).not.toHaveProperty('nationalId');
    expect(LIST_PROJECTION).not.toHaveProperty('searchText');
  });
});

describe('toDetail: ownerManagers và creator (FR-30)', () => {
  const owner = {
    userId: String(new Types.ObjectId()),
    fullName: 'Quản lý nhóm chủ',
    role: UserRole.MANAGER,
  };
  const creator = {
    userId: String(new Types.ObjectId()),
    fullName: 'Người tạo',
    role: UserRole.STAFF,
  };

  it('FR-30: chuyển nguyên ownerManagers và creator vào chi tiết khách (trường cộng thêm)', () => {
    const detail = toDetail(doc, refs, actor(UserRole.STAFF), {
      ownerManagers: [owner],
      creator,
      managerIds: [],
    });
    expect(detail.ownerManagers).toEqual([owner]);
    expect(detail.creator).toEqual(creator);
  });

  it('FR-30: không truyền thì mặc định ownerManagers [] và creator null, không bỏ mất trường cũ', () => {
    const detail = toDetail(doc, refs, actor(UserRole.STAFF));
    expect(detail.ownerManagers).toEqual([]);
    expect(detail.creator).toBeNull();
    expect(detail.createdBy).toBeNull();
    expect(detail.careTeam).toHaveLength(1);
  });

  it('FR-30: ownerManagers/creator không đổi quyền: cờ permissions giống hệt khi không truyền', () => {
    const plain = toDetail(doc, refs, actor(UserRole.STAFF)).permissions;
    const withOwners = toDetail(doc, refs, actor(UserRole.STAFF), {
      ownerManagers: [owner],
      creator,
      managerIds: [],
    }).permissions;
    expect(withOwners).toEqual(plain);
  });
});
