import { Types } from 'mongoose';
import { ListGroup } from '../../catalogs/catalog.enums';
import {
  findStatusRefsByGroups,
  statusInRefsCondition,
  statusNotInRefsCondition,
} from './status-group-codes.util';

const modelReturning = (rows: Array<{ _id: Types.ObjectId; code: string }>) => {
  const query = {
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn(() => Promise.resolve(rows)),
  };
  return { model: { find: jest.fn(() => query) }, query };
};

describe('findStatusRefsByGroups (FR-40)', () => {
  it('FR-40: trả code VÀ id của mọi tình trạng thuộc các nhóm, chỉ chọn field code (không lộ field khác)', async () => {
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()];
    const { model, query } = modelReturning([
      { _id: a, code: 'NET' },
      { _id: b, code: 'INTERESTED' },
    ]);

    const refs = await findStatusRefsByGroups(model as never, [
      ListGroup.NOT_CONTACTED,
      ListGroup.INTERESTED,
    ]);

    expect(refs).toEqual({ codes: ['NET', 'INTERESTED'], ids: [a, b] });
    expect(model.find).toHaveBeenCalledWith({
      listGroup: { $in: [ListGroup.NOT_CONTACTED, ListGroup.INTERESTED] },
    });
    expect(query.select).toHaveBeenCalledWith('code');
  });

  it('FR-40 (biên): không có tình trạng nào thuộc nhóm => hai mảng rỗng', async () => {
    const { model } = modelReturning([]);
    await expect(
      findStatusRefsByGroups(model as never, [ListGroup.DROPPED]),
    ).resolves.toEqual({ codes: [], ids: [] });
  });
});

describe('điều kiện tình trạng theo code kèm dự phòng id (FR-40, Q3 ghi kép)', () => {
  const id = new Types.ObjectId();
  const refs = { codes: ['DROPPED'], ids: [id] };

  it('FR-40: "thuộc tập" = statusCode $in HOẶC (thiếu statusCode VÀ statusId $in)', () => {
    expect(statusInRefsCondition(refs)).toEqual({
      $or: [
        { statusCode: { $in: ['DROPPED'] } },
        { statusCode: null, statusId: { $in: [id] } },
      ],
    });
  });

  it('FR-40: "không thuộc tập" là phủ định đúng của "thuộc tập" (khách Bỏ thiếu statusCode cũng bị loại)', () => {
    expect(statusNotInRefsCondition(refs)).toEqual({
      $nor: [
        { statusCode: { $in: ['DROPPED'] } },
        { statusCode: null, statusId: { $in: [id] } },
      ],
    });
  });
});
