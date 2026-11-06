import type {
  AnyBulkWriteOperation,
  Collection,
  Db,
  Document,
  ObjectId,
} from 'mongodb';
import {
  mapPropertyTypeTexts,
  type PropertyTypeOption,
} from '../../projects/property-type-matcher.util';

export interface MigrateProjectPropertyTypeCodesResult {
  /** Số dự án chưa có `propertyTypeCodes` được điền (kể cả dự án không có chữ loại hình nào -> `[]`). */
  projectsCoded: number;
  /** Trong số đó, số dự án có ít nhất một chữ không khớp (vào `unmappedPropertyTypes`). */
  projectsWithUnmapped: number;
  /** Chữ loại hình không khớp (nguyên văn, bỏ trùng, tối đa `MAX_UNMAPPED_LISTED`): Quản trị cần chọn lại. */
  unmappedTexts: string[];
}

/** Thiếu trường chân dung `property_type` hoặc trường không có lựa chọn nào: dừng, không đoán (Architecture 5.1.5). */
export class PropertyTypeFieldMissingError extends Error {
  constructor(reason: string) {
    super(
      `Không thể ánh xạ loại hình dự án: ${reason}. Seed trường chân dung property_type rồi chạy lại.`,
    );
    this.name = 'PropertyTypeFieldMissingError';
  }
}

const PROJECTS = 'projects';
const PERSONA_FIELDS = 'persona_fields';
const PROPERTY_TYPE_FIELD_KEY = 'property_type';

/** Kích thước lô khi duyệt dự án (phân trang theo `_id`). */
const BATCH_SIZE = 500;
/** Giới hạn số chữ không khớp liệt kê (tránh phình log nếu dữ liệu hỏng diện rộng). */
const MAX_UNMAPPED_LISTED = 1000;

/**
 * Đọc lựa chọn của trường `property_type`, TÍNH CẢ lựa chọn đã tắt và trường đã tắt/xóa mềm (dự án cũ vẫn có thể
 * dùng chúng). Thiếu trường hoặc không có lựa chọn hợp lệ nào thì ném lỗi.
 */
async function loadPropertyTypeOptions(db: Db): Promise<PropertyTypeOption[]> {
  const field = await db
    .collection(PERSONA_FIELDS)
    .findOne({ key: PROPERTY_TYPE_FIELD_KEY }, { projection: { options: 1 } });
  if (!field) {
    throw new PropertyTypeFieldMissingError(
      `không có trường chân dung "${PROPERTY_TYPE_FIELD_KEY}"`,
    );
  }
  const rawOptions: unknown[] = Array.isArray(field.options)
    ? (field.options as unknown[])
    : [];
  const options: PropertyTypeOption[] = [];
  for (const raw of rawOptions) {
    const option = raw as Partial<PropertyTypeOption> | null;
    if (
      option &&
      typeof option.value === 'string' &&
      option.value !== '' &&
      typeof option.label === 'string'
    ) {
      options.push({
        value: option.value,
        label: option.label,
        isActive: option.isActive,
      });
    }
  }
  if (options.length === 0) {
    throw new PropertyTypeFieldMissingError(
      `trường "${PROPERTY_TYPE_FIELD_KEY}" không có lựa chọn nào`,
    );
  }
  return options;
}

/** Lấy các phần tử chuỗi của `propertyTypes` (dữ liệu cũ có thể thiếu field hoặc lẫn kiểu lạ: bỏ qua phần không phải chuỗi). */
const toTexts = (value: unknown): string[] =>
  Array.isArray(value)
    ? (value as unknown[]).filter(
        (item): item is string => typeof item === 'string',
      )
    : [];

/** Có dự án chưa có `propertyTypeCodes` mà `propertyTypes` chứa ít nhất một chữ (không rỗng) cần dịch sang mã không. */
async function hasProjectsNeedingCodes(
  projects: Collection<Document>,
): Promise<boolean> {
  const found = await projects.findOne(
    {
      propertyTypeCodes: { $exists: false },
      propertyTypes: { $elemMatch: { $regex: '\\S' } },
    },
    { projection: { _id: 1 } },
  );
  return found !== null;
}

/**
 * Migration 008 (FR-46) — ánh xạ chữ loại hình cũ `projects.propertyTypes` sang `value` của lựa chọn trường chân dung
 * `property_type`, bằng bộ khớp chung `mapPropertyTypeTexts` (khớp `value`/nhãn sau chuẩn hóa + bảng từ đồng nghĩa):
 *
 * - Khớp: vào `propertyTypeCodes` (bỏ trùng, giữ thứ tự). Không khớp: vào `unmappedPropertyTypes` (nguyên văn).
 * - `propertyTypes` cũ GIỮ NGUYÊN (không mất dữ liệu, image cũ vẫn đọc được).
 * - Chỉ xử lý dự án CHƯA có `propertyTypeCodes`; ghi bằng `updateOne` có điều kiện đó nên chạy lại không đổi gì.
 * - Dùng driver gốc nên KHÔNG đổi `updatedAt`/`version`, không sinh audit hay thông báo.
 * - Thiếu trường `property_type` (hoặc không có lựa chọn): nếu KHÔNG có dự án nào cần mã (`projects` rỗng hoặc không
 *   dự án nào có chữ loại hình cần dịch) thì coi là "không có việc": log cảnh báo, trả kết quả 0, không ném lỗi (DB mới
 *   tinh khi deploy lần đầu). Nếu CÓ dự án cần mã -> ném `PropertyTypeFieldMissingError`, cả khi dry-run.
 *
 * `apply=false` (dry-run) chỉ đếm và liệt kê chữ không khớp, không ghi.
 */
export async function migrateProjectPropertyTypeCodes(
  db: Db,
  apply: boolean,
  log?: (message: string) => void,
): Promise<MigrateProjectPropertyTypeCodesResult> {
  const projects = db.collection(PROJECTS);
  let options: PropertyTypeOption[];
  try {
    options = await loadPropertyTypeOptions(db);
  } catch (error) {
    // DB mới tinh: trường `property_type` chỉ được seed khi backend khởi động lần đầu (sau bước migrate của deploy).
    // Chưa có dự án nào cần mã thì không có việc để làm: cảnh báo rồi thoát OK. Có dự án cần mã thì đây là cấu hình
    // hỏng thật: ném lại lỗi, không đoán.
    if (
      error instanceof PropertyTypeFieldMissingError &&
      !(await hasProjectsNeedingCodes(projects))
    ) {
      log?.(
        `CẢNH BÁO: ${error.message} Không có dự án nào cần gán propertyTypeCodes nên bỏ qua (không có việc). Sau khi backend seed trường này, chạy lại bước bù (crm-catalog-codes --apply) nếu có dự án mới.`,
      );
      return { projectsCoded: 0, projectsWithUnmapped: 0, unmappedTexts: [] };
    }
    throw error;
  }
  const unmappedTexts = new Set<string>();
  let projectsCoded = 0;
  let projectsWithUnmapped = 0;
  let lastId: ObjectId | null = null;

  for (;;) {
    const filter: Document = { propertyTypeCodes: { $exists: false } };
    if (lastId) filter._id = { $gt: lastId };
    const batch = await projects
      .find(filter, { projection: { propertyTypes: 1 } })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]._id;

    const operations: AnyBulkWriteOperation<Document>[] = [];
    for (const doc of batch) {
      const { codes, unmapped } = mapPropertyTypeTexts(
        toTexts(doc.propertyTypes),
        options,
      );
      if (unmapped.length > 0) projectsWithUnmapped += 1;
      for (const text of unmapped) {
        if (unmappedTexts.size < MAX_UNMAPPED_LISTED) unmappedTexts.add(text);
      }
      operations.push({
        updateOne: {
          filter: { _id: doc._id, propertyTypeCodes: { $exists: false } },
          update: {
            $set: {
              propertyTypeCodes: codes,
              unmappedPropertyTypes: unmapped,
            },
          },
        },
      });
    }
    if (apply) {
      const result = await projects.bulkWrite(operations, { ordered: false });
      projectsCoded += result.modifiedCount;
    } else {
      projectsCoded += operations.length;
    }
  }

  const result: MigrateProjectPropertyTypeCodesResult = {
    projectsCoded,
    projectsWithUnmapped,
    unmappedTexts: [...unmappedTexts],
  };
  log?.(
    `${apply ? 'Đã điền' : 'Dry-run'}: projectsCoded=${projectsCoded} projectsWithUnmapped=${projectsWithUnmapped} unmappedTexts=${result.unmappedTexts.length}`,
  );
  if (result.unmappedTexts.length > 0) {
    log?.(
      `Chữ loại hình không khớp (Quản trị cần chọn lại): ${result.unmappedTexts.map((text) => JSON.stringify(text)).join(', ')}`,
    );
  }
  return result;
}
