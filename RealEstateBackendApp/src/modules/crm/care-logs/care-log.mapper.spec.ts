import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmActor } from '../common/access/crm-actor';
import {
  CareLogLean,
  ContactResultRefs,
  toCareLogResponse,
} from './care-log.mapper';

const actor: CrmActor = {
  userId: new Types.ObjectId(),
  role: UserRole.ADMIN,
  roles: [UserRole.ADMIN],
  displayName: 'Quản trị',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
};
const resultId = new Types.ObjectId();
const users = new Map<string, string>();

const logWith = (extra: Record<string, unknown>): CareLogLean =>
  ({
    _id: new Types.ObjectId(),
    customerId: new Types.ObjectId(),
    authorId: new Types.ObjectId(),
    authorName: 'Hạnh',
    occurredAt: new Date('2026-10-20T03:00:00Z'),
    content: 'Gọi lần 1',
    contactChannel: 'CALL',
    contactResultId: null,
    attachments: [],
    nextAction: null,
    source: 'MANUAL',
    editedAt: null,
    ...extra,
  }) as unknown as CareLogLean;

const map = (contactResults: ContactResultRefs) => ({ users, contactResults });

describe('toCareLogResponse: contactResult dạng CatalogRefDto (FR-40)', () => {
  const refs: ContactResultRefs = new Map([
    [String(resultId), { code: 'KHONG_NGHE_MAY', label: 'Không nghe máy' }],
  ]);

  it('FR-40: bản ghi đã có contactResultCode thì trả code đã lưu, label theo nhãn hiện tại của danh mục', () => {
    const renamed: ContactResultRefs = new Map([
      [String(resultId), { code: 'KHONG_NGHE_MAY', label: 'Máy bận' }],
    ]);

    const response = toCareLogResponse(
      logWith({
        contactResultId: resultId,
        contactResultCode: 'KHONG_NGHE_MAY',
      }),
      actor,
      map(renamed),
      new Map(),
    );

    expect(response.contactResult).toEqual({
      id: String(resultId),
      code: 'KHONG_NGHE_MAY',
      label: 'Máy bận',
    });
  });

  it('FR-40: bản ghi cũ thiếu contactResultCode thì mapper dịch code từ id, không lỗi', () => {
    const response = toCareLogResponse(
      logWith({ contactResultId: resultId }),
      actor,
      map(refs),
      new Map(),
    );

    expect(response.contactResult).toEqual({
      id: String(resultId),
      code: 'KHONG_NGHE_MAY',
      label: 'Không nghe máy',
    });
  });

  it('FR-40: contactResultCode là null (dữ liệu v1.0.3 ghi dở) vẫn dịch từ id', () => {
    const response = toCareLogResponse(
      logWith({ contactResultId: resultId, contactResultCode: null }),
      actor,
      map(refs),
      new Map(),
    );

    expect(response.contactResult?.code).toBe('KHONG_NGHE_MAY');
  });

  it('FR-40: id không còn trong danh mục (xóa cứng) và chưa có code thì code/label rỗng, không ném lỗi', () => {
    const response = toCareLogResponse(
      logWith({ contactResultId: resultId }),
      actor,
      map(new Map()),
      new Map(),
    );

    expect(response.contactResult).toEqual({
      id: String(resultId),
      code: '',
      label: '',
    });
  });

  it('FR-40: không chọn kết quả liên hệ thì contactResult là null (kể cả khi có code rác)', () => {
    const response = toCareLogResponse(
      logWith({ contactResultId: null, contactResultCode: null }),
      actor,
      map(refs),
      new Map(),
    );

    expect(response.contactResult).toBeNull();
  });
});
