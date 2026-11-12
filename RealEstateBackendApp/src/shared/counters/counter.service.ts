import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Counter } from './counter.schema';

/** Khoảng số thứ tự vừa cấp, gồm cả hai đầu: `first..last` (`last - first + 1 === count`). */
export interface CounterRange {
  first: number;
  last: number;
}

@Injectable()
export class CounterService {
  constructor(
    @InjectModel(Counter.name) private readonly counterModel: Model<Counter>,
  ) {}

  /**
   * Cấp `count` số thứ tự liên tiếp cho `key` bằng MỘT lần `$inc` nguyên tử.
   *
   * Luồng: `findOneAndUpdate({_id:key},{$inc:{seq:count}},{upsert,returnDocument:'after'})` trả `seq` sau khi tăng,
   * khoảng cấp = `[seq - count + 1, seq]`. Lô n mã chỉ tốn một lần ghi (không mỗi mã một lần).
   *
   * `session` BẮT BUỘC và phải là session của transaction tạo bản ghi: `$inc` rollback cùng bản ghi
   * nên không thủng số, không tái sử dụng. Để giữ khóa doc counter ngắn nhất, caller nên gọi hàm này
   * SAU CÙNG (sau mọi đọc/kiểm tra) rồi mới insert.
   *
   * @throws RangeError khi `count` không phải số nguyên >= 1.
   */
  async next(
    key: string,
    count: number,
    session: ClientSession,
  ): Promise<CounterRange> {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError(
        `Số lượng cần cấp phải là số nguyên >= 1, nhận: ${String(count)}`,
      );
    }
    const updated = await this.counterModel
      .findOneAndUpdate(
        { _id: key },
        { $inc: { seq: count } },
        { upsert: true, returnDocument: 'after', session },
      )
      .lean()
      .exec();
    if (!updated) {
      // Không thể xảy ra khi upsert thành công; chặn để không cấp khoảng sai.
      throw new Error(`Không cấp được bộ đếm cho khóa ${key}`);
    }
    return { first: updated.seq - count + 1, last: updated.seq };
  }
}
