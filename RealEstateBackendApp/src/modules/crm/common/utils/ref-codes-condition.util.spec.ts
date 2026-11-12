import { Types } from 'mongoose';
import {
  refArrayInCondition,
  refInCondition,
} from './ref-codes-condition.util';

const oid = () => new Types.ObjectId();
const single = { codeField: 'sourceCode', idField: 'sourceId' };
const array = {
  codeField: 'interestedProjectCodes',
  idField: 'interestedProjectIds',
};

describe('refInCondition (trường đơn)', () => {
  it('có cả mã lẫn id: hai nhánh, nhánh id yêu cầu code null (khách đã backfill không khớp hai nhánh)', () => {
    const id = oid();
    expect(refInCondition(single, { codes: ['A'], ids: [id] })).toEqual({
      $or: [
        { sourceCode: { $in: ['A'] } },
        { sourceCode: null, sourceId: { $in: [id] } },
      ],
    });
  });

  it('id rỗng (mã không tồn tại): chỉ còn nhánh mã', () => {
    expect(refInCondition(single, { codes: ['A'], ids: [] })).toEqual({
      sourceCode: { $in: ['A'] },
    });
  });

  it('mã rỗng (khu vực chưa có code): chỉ còn nhánh id', () => {
    const id = oid();
    expect(refInCondition(single, { codes: [], ids: [id] })).toEqual({
      sourceCode: null,
      sourceId: { $in: [id] },
    });
  });

  it('cả hai rỗng: không khớp bản ghi nào', () => {
    expect(refInCondition(single, { codes: [], ids: [] })).toEqual({
      sourceCode: { $in: [] },
    });
  });
});

describe('refArrayInCondition (trường mảng)', () => {
  it('nhánh id chỉ áp cho khách có mảng mã vắng/null/rỗng', () => {
    const id = oid();
    expect(refArrayInCondition(array, { codes: ['P'], ids: [id] })).toEqual({
      $or: [
        { interestedProjectCodes: { $in: ['P'] } },
        {
          interestedProjectCodes: { $in: [null, []] },
          interestedProjectIds: { $in: [id] },
        },
      ],
    });
  });

  it('id rỗng: chỉ còn nhánh mã; cả hai rỗng: không khớp ai', () => {
    expect(refArrayInCondition(array, { codes: ['P'], ids: [] })).toEqual({
      interestedProjectCodes: { $in: ['P'] },
    });
    expect(refArrayInCondition(array, { codes: [], ids: [] })).toEqual({
      interestedProjectCodes: { $in: [] },
    });
  });
});
