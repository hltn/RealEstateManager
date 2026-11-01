import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import { CatalogItemType } from '../catalogs/catalog.enums';
import {
  CatalogItem,
  CatalogItemDocument,
} from '../catalogs/schemas/catalog-item.schema';
import type { PersonaFieldDef } from './persona.rules';
import {
  PersonaField,
  PersonaFieldDocument,
  PersonaFieldLean,
} from './schemas/persona-field.schema';

const STATE_COLLECTION = 'persona_config_state';
const STATE_ID = 'PERSONA_CONFIG';

export interface PersonaGroupInfo {
  code: string;
  label: string;
  order: number;
}

/**
 * Cấu hình chân dung dùng chung: nạp trường/nhóm đang hoạt động và quản "phiên bản cấu hình".
 *
 * Phiên bản cấu hình là bộ đếm tăng mỗi khi Quản trị đổi cấu hình ảnh hưởng độ đầy đủ/token lọc/dịp đặc biệt
 * (thêm/bớt/tắt trường, đổi trọng số, bật/tắt lọc/dịp). Mỗi khách ghi nhận phiên bản mà các thuộc tính suy ra của họ
 * được tính theo (`customers.personaConfigVersion`) nên việc "ai còn cần tính lại" xác định được từ chính dữ liệu —
 * không cần hàng đợi: job chết giữa chừng hay khởi động lại thì lần chạy sau tự nhặt phần còn dở.
 */
@Injectable()
export class PersonaConfigService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PersonaField.name)
    private readonly fieldModel: Model<PersonaFieldDocument>,
    @InjectModel(CatalogItem.name)
    private readonly itemModel: Model<CatalogItemDocument>,
  ) {}

  /** Tạo bản ghi trạng thái nếu chưa có. Gọi NGOÀI transaction trước khi tăng phiên bản lần đầu. */
  async ensureState(): Promise<void> {
    try {
      await this.connection
        .collection(STATE_COLLECTION)
        .updateOne(
          { _id: STATE_ID as never },
          { $setOnInsert: { version: 0 } },
          { upsert: true },
        );
    } catch (error) {
      // Hai instance cùng upsert lần đầu: bên thua nhận E11000, bản ghi đã tồn tại nên bỏ qua.
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  async getVersion(session?: ClientSession): Promise<number> {
    const state = await this.connection
      .collection<{ _id: string; version: number }>(STATE_COLLECTION)
      .findOne({ _id: STATE_ID }, { session });
    return state?.version ?? 0;
  }

  /** Tăng phiên bản NGOÀI transaction (seed thêm trường mới); trả phiên bản mới. */
  async bumpVersionNow(): Promise<number> {
    await this.ensureState();
    const state = await this.connection
      .collection<{ _id: string; version: number }>(STATE_COLLECTION)
      .findOneAndUpdate(
        { _id: STATE_ID },
        { $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
    return state?.version ?? 0;
  }

  /** Tăng phiên bản trong transaction của thao tác đổi cấu hình; trả phiên bản mới. */
  async bumpVersion(session: ClientSession): Promise<number> {
    const state = await this.connection
      .collection<{ _id: string; version: number }>(STATE_COLLECTION)
      .findOneAndUpdate(
        { _id: STATE_ID },
        { $inc: { version: 1 } },
        { session, returnDocument: 'after' },
      );
    return state?.version ?? 0;
  }

  /** Trường đang hoạt động (chưa xóa mềm), theo thứ tự hiển thị. */
  async loadActiveFields(session?: ClientSession): Promise<PersonaFieldLean[]> {
    const query = this.fieldModel
      .find({ isActive: true, deletedAt: null })
      .sort({ order: 1, _id: 1 });
    if (session) query.session(session);
    return await query.lean().exec();
  }

  /** Nhóm trường (catalog PERSONA_GROUP) đang hoạt động, theo thứ tự hiển thị. */
  async loadGroups(session?: ClientSession): Promise<PersonaGroupInfo[]> {
    const query = this.itemModel
      .find({
        type: CatalogItemType.PERSONA_GROUP,
        isActive: true,
        deletedAt: null,
      })
      .sort({ order: 1, _id: 1 });
    if (session) query.session(session);
    const rows = await query.lean().exec();
    return rows.map((row) => ({
      code: row.code,
      label: row.label,
      order: row.order,
    }));
  }
}

/** Dạng logic thuần của một trường (bỏ metadata Mongo) để đưa vào các hàm trong `persona.rules`. */
export const toFieldDef = (field: PersonaFieldLean): PersonaFieldDef => ({
  key: field.key,
  label: field.label,
  groupCode: field.groupCode,
  type: field.type,
  options: field.options?.map((option) => ({
    value: option.value,
    label: option.label,
    isActive: option.isActive,
  })),
  order: field.order,
  weight: field.weight,
  suggestPriority: field.suggestPriority,
  isFilterable: field.isFilterable,
  isOccasion: field.isOccasion,
  isSensitive: field.isSensitive,
  isActive: field.isActive,
});
