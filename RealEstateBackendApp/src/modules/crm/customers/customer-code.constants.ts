/**
 * Hằng số và hàm thuần cho mã khách tự sinh (`KH-000001`), FR-07/FR-08/FR-21.
 *
 * Tệp KHÔNG phụ thuộc NestJS/Mongoose để import được từ schema, migration 010, CLI bù mã và service:
 * một nguồn duy nhất, tránh lệch định dạng/tùy chọn index giữa các nơi.
 */

/** Tiền tố mã khách. */
export const CUSTOMER_CODE_PREFIX = 'KH-';

/** Độ rộng tối thiểu phần số (đệm 0 bên trái); vượt 999.999 thì tự dài thêm, không cắt. */
export const CUSTOMER_CODE_WIDTH = 6;

/** Khóa (`_id`) của doc trong collection `counters` giữ số thứ tự mã khách đã cấp lớn nhất. */
export const COUNTER_KEY = 'CUSTOMER_CODE';

/**
 * Index partial unique của `customers.customerCode`. Schema (`schema.index`) và migration 010
 * (`createIndex`) cùng dùng hằng số này để khớp từng tùy chọn, tránh `IndexOptionsConflict`.
 * Partial (`$type: 'string'`) để khách chưa có mã không bị chặn trong giai đoạn trước khi bù mã.
 */
export const CUSTOMER_CODE_INDEX = {
  key: { customerCode: 1 },
  options: {
    name: 'customerCode_1',
    unique: true,
    partialFilterExpression: { customerCode: { $type: 'string' } },
  },
} as const;

/**
 * Dựng mã khách từ số thứ tự: `1` -> `KH-000001`, `999999` -> `KH-999999`, `1000000` -> `KH-1000000`.
 * @throws RangeError khi `seq` không phải số nguyên an toàn >= 1 (counter không bao giờ cấp 0/âm).
 */
export function formatCustomerCode(seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(
      `Số thứ tự mã khách phải là số nguyên >= 1, nhận: ${String(seq)}`,
    );
  }
  return `${CUSTOMER_CODE_PREFIX}${String(seq).padStart(CUSTOMER_CODE_WIDTH, '0')}`;
}

/**
 * Tách số thứ tự từ mã khách; trả `null` nếu sai định dạng.
 * Chỉ nhận dạng chuẩn do `formatCustomerCode` sinh ra (đúng hoa/thường, đủ độ rộng, không đệm 0 thừa):
 * so lại bằng `formatCustomerCode` nên `KH-0000001`, `kh-000001`, `KH-12`, `KH-000000` đều là `null`.
 * (Việc chấp nhận `kh-12` khi tìm kiếm thuộc `parseKeyword`, không thuộc hàm này.)
 */
export function parseCustomerCodeSeq(code: unknown): number | null {
  if (typeof code !== 'string') return null;
  const match = /^KH-(\d+)$/.exec(code);
  if (!match) return null;
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  return formatCustomerCode(seq) === code ? seq : null;
}
