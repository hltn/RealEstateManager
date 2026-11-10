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

  it('permissions.canDelete theo quyền xóa thật: STAFF phụ trách chính chỉ khi khách "Bỏ"; Manager chỉ khi khách thuộc nhóm mình quản lý', () => {
    const team = new Types.ObjectId();
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
    const canDelete = (role: UserRole, group: ListGroup, d = doc, a = {}) =>
      toDetail(d, withStatus(group), { ...actor(role), ...a }).permissions
        .canDelete;
    expect(canDelete(UserRole.STAFF, ListGroup.DROPPED)).toBe(true);
    expect(canDelete(UserRole.STAFF, ListGroup.INTERESTED)).toBe(false);
    const inTeam = { ...doc, teamIds: [team] } as unknown as CustomerLean;
    expect(
      canDelete(UserRole.MANAGER, ListGroup.INTERESTED, inTeam, {
        managedTeamIds: [team],
      }),
    ).toBe(true);
    // Manager là phụ trách chính nhưng khách không thuộc nhóm mình quản lý: không xóa được.
    expect(canDelete(UserRole.MANAGER, ListGroup.DROPPED)).toBe(false);
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
