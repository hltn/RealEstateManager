import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { PersonaConfigService, toFieldDef } from './persona-config.service';
import { derivePersona } from './persona.rules';

const BATCH_SIZE = 200;
/** Số lượt quét tối đa mỗi lần chạy khi khách liên tục bị sửa đúng lúc job ghi (lần sau sẽ nhặt tiếp). */
const MAX_PASSES = 5;
/** Job lỗi giữa chừng (DB đứt...) thì thử lại tối đa chừng này lần liên tiếp rồi bỏ (lần khởi động sau sẽ nhặt tiếp). */
const MAX_ATTEMPTS = 3;

/** Khách cần tính lại: dấu phiên bản NHỎ HƠN hiện hành hoặc chưa có dấu (đơn điệu: không bao giờ "lùi" phiên bản). */
const staleCondition = (version: number) => ({
  $or: [
    { personaConfigVersion: { $lt: version } },
    { personaConfigVersion: { $exists: false } },
  ],
});

/**
 * Tính lại độ đầy đủ, token lọc và dịp đặc biệt của khách sau khi Quản trị đổi cấu hình trường (tài liệu 04 mục 3.2.2,
 * job `persona.recompute-completeness`).
 *
 * LỆCH TÀI LIỆU (chưa có BullMQ, M5): chạy nền TRONG tiến trình thay vì hàng đợi. Để vẫn bền và an toàn khi nhiều
 * instance/khởi động lại: "việc còn dở" được xác định từ dữ liệu (`customers.personaConfigVersion` nhỏ hơn phiên bản
 * hiện hành; điều kiện đơn điệu nên instance chạy với ảnh chụp cũ không đè được kết quả mới), job chạy lại ở mỗi lần khởi động và chỉ ghi vào khách khi khách chưa bị sửa kể từ lúc đọc (`__v`).
 * Job KHÔNG đụng `persona`, `__v`, `lastUpdatedAt` — chỉ ba thuộc tính suy ra + dấu phiên bản — nên không làm
 * người đang sửa hồ sơ dính `VERSION_CONFLICT` và không đẩy khách lên đầu danh sách.
 */
@Injectable()
export class PersonaRecomputeService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PersonaRecomputeService.name);
  private running: Promise<number> | null = null;
  private rerunRequested = false;
  private shuttingDown = false;
  private wakeSleep: (() => void) | null = null;
  /** Độ trễ cơ sở của lần thử lại (nhân đôi mỗi lần). Công khai chỉ để test rút ngắn. */
  retryBaseDelayMs = 2000;

  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly config: PersonaConfigService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  /** Khởi động: nhặt phần việc còn dở của lần chạy trước (không chặn quá trình khởi động). */
  onApplicationBootstrap(): void {
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED)) return;
    void this.run();
  }

  /** Tắt ứng dụng: ngừng nhận lô mới, hủy chờ thử lại và đợi lô đang ghi xong để không bỏ dở giữa một `bulkWrite`. */
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.wakeSleep?.();
    await this.running;
  }

  /**
   * Yêu cầu tính lại. Chỉ một lượt chạy tại một thời điểm trong tiến trình: gọi khi đang chạy thì đánh dấu chạy
   * thêm một lượt sau khi lượt hiện tại xong (cấu hình có thể vừa đổi tiếp). Không bao giờ ném lỗi; Promise trả
   * về hoàn tất khi các lượt xong, với số khách đã cập nhật.
   */
  run(): Promise<number> {
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    const current = this.loop()
      .catch((error: unknown) => {
        this.logger.error(
          `Tính lại chân dung thất bại: ${(error as Error)?.message}`,
          (error as Error)?.stack,
        );
        return 0;
      })
      .finally(() => {
        this.running = null;
      });
    this.running = current;
    return current;
  }

  /**
   * Lặp đến khi hết việc. Lỗi giữa chừng: ghi log, chờ lùi dần (2s, 4s...) rồi thử lại, tối đa `MAX_ATTEMPTS` lần liên
   * tiếp; hết lượt thì dừng (việc dở vẫn nằm trong dữ liệu, lần khởi động sau nhặt tiếp) — không bao giờ lặp vô hạn.
   */
  private async loop(): Promise<number> {
    let updated = 0;
    let failures = 0;
    do {
      this.rerunRequested = false;
      try {
        updated += await this.recomputeStale();
        failures = 0;
      } catch (error) {
        failures += 1;
        const message = (error as Error)?.message;
        if (failures >= MAX_ATTEMPTS || this.shuttingDown) {
          this.logger.error(
            `Tính lại chân dung thất bại sau ${failures} lần, dừng: ${message}`,
            (error as Error)?.stack,
          );
          break;
        }
        const delay = this.retryBaseDelayMs * 2 ** (failures - 1);
        this.logger.warn(
          `Tính lại chân dung lỗi (lần ${failures}/${MAX_ATTEMPTS}), thử lại sau ${delay}ms: ${message}`,
        );
        await this.sleep(delay);
        this.rerunRequested = true;
      }
    } while (this.rerunRequested && !this.shuttingDown);
    return updated;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.wakeSleep = done;
    });
  }

  /** Quét theo `_id`, tính lại các khách có chân dung mà phiên bản cấu hình lệch phiên bản hiện hành. */
  private async recomputeStale(): Promise<number> {
    let total = 0;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const version = await this.config.getVersion();
      const fields = (await this.config.loadActiveFields()).map(toFieldDef);
      const { updated, skipped } = await this.scan(version, fields);
      total += updated;
      if (skipped === 0 || this.shuttingDown) return total;
    }
    return total;
  }

  private async scan(
    version: number,
    fields: ReturnType<typeof toFieldDef>[],
  ): Promise<{ updated: number; skipped: number }> {
    let lastId: Types.ObjectId | null = null;
    let updated = 0;
    let skipped = 0;
    while (!this.shuttingDown) {
      const batch: Array<
        Pick<Customer, 'persona'> & { _id: Types.ObjectId; __v: number }
      > = await this.customerModel
        .find({
          ...(lastId && { _id: { $gt: lastId } }),
          'persona.0': { $exists: true },
          ...staleCondition(version),
        })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .select('persona __v')
        .lean()
        .exec();
      if (batch.length === 0) break;

      const result = await this.customerModel.bulkWrite(
        batch.map((doc) => ({
          updateOne: {
            // `__v`: khách vừa bị sửa thì bỏ qua (lượt sau xử lý với dữ liệu mới); điều kiện phiên bản: không đè kết quả
            // đã tính theo phiên bản mới hơn bởi instance khác.
            filter: {
              _id: doc._id,
              __v: doc.__v,
              ...staleCondition(version),
            },
            update: {
              $set: {
                ...derivePersona(fields, doc.persona),
                personaConfigVersion: version,
              },
            },
          },
        })),
        { ordered: false, timestamps: false },
      );
      updated += result.modifiedCount;
      skipped += batch.length - result.matchedCount;
      lastId = batch[batch.length - 1]._id;
    }
    return { updated, skipped };
  }
}
