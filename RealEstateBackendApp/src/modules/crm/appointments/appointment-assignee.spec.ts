import { Types } from 'mongoose';
import {
  assigneeFilter,
  getAssigneeIds,
  requestedAssigneeIds,
  toAssigneeWrite,
} from './appointment-assignee';

const id = () => new Types.ObjectId();

describe('appointment-assignee (FR-30)', () => {
  describe('getAssigneeIds: đọc tương thích cửa sổ trước backfill 012', () => {
    it('FR-30: có assigneeIds thì dùng đúng danh sách đó, giữ thứ tự, bỏ qua assigneeId cũ', () => {
      const [a, b, legacy] = [id(), id(), id()];
      expect(
        getAssigneeIds({ assigneeIds: [b, a], assigneeId: legacy }),
      ).toEqual([b, a]);
    });

    it('FR-30: lịch cũ chưa có assigneeIds thì thành [assigneeId]', () => {
      const legacy = id();
      expect(getAssigneeIds({ assigneeId: legacy })).toEqual([legacy]);
      expect(
        getAssigneeIds({ assigneeIds: undefined, assigneeId: legacy }),
      ).toEqual([legacy]);
      expect(getAssigneeIds({ assigneeIds: null, assigneeId: legacy })).toEqual(
        [legacy],
      );
    });

    it('FR-30: biên - assigneeIds rỗng (đã backfill từ bản ghi thiếu assigneeId) là rỗng, KHÔNG rơi về assigneeId', () => {
      expect(getAssigneeIds({ assigneeIds: [], assigneeId: id() })).toEqual([]);
    });

    it('FR-30: biên - thiếu cả hai thì rỗng', () => {
      expect(getAssigneeIds({})).toEqual([]);
      expect(getAssigneeIds({ assigneeId: null })).toEqual([]);
    });

    it('FR-30: trả bản sao, sửa kết quả không làm hỏng bản ghi gốc', () => {
      const a = id();
      const doc = { assigneeIds: [a] };
      getAssigneeIds(doc).push(id());
      expect(doc.assigneeIds).toEqual([a]);
    });
  });

  describe('assigneeFilter: một builder lọc dùng cho hai nơi lọc', () => {
    it('FR-30: một id (không phải mảng) vẫn ra dạng $in một phần tử', () => {
      const a = id();
      expect(assigneeFilter(a)).toEqual({
        $or: [
          { assigneeIds: { $in: [a] } },
          { assigneeIds: { $exists: false }, assigneeId: { $in: [a] } },
        ],
      });
    });

    it('FR-30: nhiều id vào cùng một $in ở cả hai nhánh (mới và cửa sổ trước backfill)', () => {
      const ids = [id(), id(), id()];
      expect(assigneeFilter(ids)).toEqual({
        $or: [
          { assigneeIds: { $in: ids } },
          { assigneeIds: { $exists: false }, assigneeId: { $in: ids } },
        ],
      });
    });

    it('FR-30: mảng rỗng cho $in rỗng ở cả hai nhánh (không khớp bản ghi nào)', () => {
      expect(assigneeFilter([])).toEqual({
        $or: [
          { assigneeIds: { $in: [] } },
          { assigneeIds: { $exists: false }, assigneeId: { $in: [] } },
        ],
      });
    });

    it('FR-30: id là ObjectId thật (đường aggregate không tự ép kiểu), kể cả khi nơi gọi đưa chuỗi', () => {
      const a = id();
      const filter = assigneeFilter([String(a) as unknown as Types.ObjectId]);
      const first = (filter.$or[0].assigneeIds as { $in: unknown[] }).$in[0];
      expect(first).toBeInstanceOf(Types.ObjectId);
      expect(String(first)).toBe(String(a));
    });
  });

  describe('toAssigneeWrite: MỘT hàm ghi kép', () => {
    it('FR-30: ghi assigneeIds và assigneeId = phần tử đầu (deprecated, giữ cho rollback)', () => {
      const [a, b] = [id(), id()];
      expect(toAssigneeWrite([a, b])).toEqual({
        assigneeIds: [a, b],
        assigneeId: a,
      });
    });

    it('FR-30: từ chối danh sách rỗng (không có người đầu để ghi kép)', () => {
      expect(() => toAssigneeWrite([])).toThrow();
    });
  });

  describe('requestedAssigneeIds: assigneeIds thắng assigneeId cũ', () => {
    it('FR-30: có cả hai thì assigneeIds thắng, khử trùng giữ thứ tự', () => {
      const [a, b, legacy] = [id(), id(), id()];
      expect(
        requestedAssigneeIds({ assigneeIds: [b, a, b], assigneeId: legacy }),
      ).toEqual([b, a]);
    });

    it('FR-30: request cũ chỉ có assigneeId vẫn chạy (thành danh sách một người)', () => {
      const legacy = id();
      expect(requestedAssigneeIds({ assigneeId: legacy })).toEqual([legacy]);
      expect(
        requestedAssigneeIds({ assigneeIds: [], assigneeId: legacy }),
      ).toEqual([legacy]);
    });

    it('FR-30: không gửi gì thì undefined (áp luật mặc định)', () => {
      expect(requestedAssigneeIds({})).toBeUndefined();
      expect(requestedAssigneeIds({ assigneeIds: [] })).toBeUndefined();
    });
  });
});
