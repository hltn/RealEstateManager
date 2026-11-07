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

describe('toCareLogResponse: URL ảnh và thumbnail (FR-26)', () => {
  const attachmentId = new Types.ObjectId();
  const attachment = (extra: Record<string, unknown> = {}) => ({
    attachmentId,
    fileKey: 'customers/c1/care-logs/goc.jpg',
    thumbKey: null,
    mimeType: 'image/jpeg',
    size: 1234,
    ...extra,
  });
  const run = (
    attachments: unknown[],
    urls: Map<string, { url: string; thumbUrl: string | null }>,
  ) =>
    toCareLogResponse(logWith({ attachments }), actor, map(new Map()), urls)
      .attachments;

  it('FR-26: ảnh có thumbKey thì thumbUrl là URL ký của thumbnail, url vẫn là ảnh gốc', () => {
    const [item] = run(
      [attachment({ thumbKey: 'customers/c1/care-logs/nho.webp' })],
      new Map([
        [
          String(attachmentId),
          { url: 'https://s3/goc?sig=1', thumbUrl: 'https://s3/nho?sig=2' },
        ],
      ]),
    );

    expect(item).toEqual({
      id: String(attachmentId),
      thumbUrl: 'https://s3/nho?sig=2',
      url: 'https://s3/goc?sig=1',
      mimeType: 'image/jpeg',
      size: 1234,
    });
  });

  it('FR-26: ảnh cũ chưa có thumbKey (thumbUrl null) thì thumbUrl rơi về url', () => {
    const [item] = run(
      [attachment()],
      new Map([
        [String(attachmentId), { url: 'https://s3/goc?sig=1', thumbUrl: null }],
      ]),
    );

    expect(item.thumbUrl).toBe('https://s3/goc?sig=1');
    expect(item.url).toBe('https://s3/goc?sig=1');
  });

  it('FR-26: chưa ký được URL nào cho ảnh (không có trong map) thì cả url và thumbUrl là chuỗi rỗng, không ném lỗi', () => {
    const [item] = run([attachment()], new Map());

    expect(item.url).toBe('');
    expect(item.thumbUrl).toBe('');
  });

  it('FR-26: nhật ký nhiều ảnh, mỗi ảnh dùng đúng URL của mình (ảnh có thumbnail lẫn ảnh chưa có)', () => {
    const second = new Types.ObjectId();
    const items = run(
      [
        attachment(),
        attachment({ attachmentId: second, thumbKey: 'x/nho2.webp' }),
      ],
      new Map([
        [String(attachmentId), { url: 'u1', thumbUrl: null }],
        [String(second), { url: 'u2', thumbUrl: 't2' }],
      ]),
    );

    expect(items.map((item) => [item.url, item.thumbUrl])).toEqual([
      ['u1', 'u1'],
      ['u2', 't2'],
    ]);
  });
});
