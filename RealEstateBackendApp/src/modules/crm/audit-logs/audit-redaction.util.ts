import { ClientSession, Connection, Types } from 'mongoose';

/** Giá trị thay thế khi xóa một giá trị chân dung theo yêu cầu (khác dấu "đã ẩn danh" của cả hồ sơ). */
export const ERASED_PLACEHOLDER = '[đã xóa]';

/** Ghi đè `value` bên trong một đối tượng `{ value, source }` của audit; giá trị không phải đối tượng giữ nguyên. */
const redactValue = (expr: string) => ({
  $cond: [
    { $eq: [{ $type: expr }, 'object'] },
    { $mergeObjects: [expr, { value: ERASED_PLACEHOLDER }] },
    expr,
  ],
});

/**
 * Xóa giá trị chân dung khỏi MỌI audit cũ của đúng một trường (`persona.<fieldKey>`) của một khách: khi người dùng xóa
 * giá trị (quyền xóa dữ liệu cá nhân) thì lịch sử không được giữ lại giá trị đó ở `from`/`to` của các lần sửa trước.
 * Cùng cơ chế ghi đè của ẩn danh hóa (pipeline update trên collection thô, trong transaction); đây là thao tác thứ hai
 * (cùng ẩn danh hóa) được phép sửa `crm_audit_logs`. Giữ nguyên `field`, `source`, thời điểm, người làm.
 */
export const redactPersonaFieldAudit = async (
  connection: Connection,
  customerId: Types.ObjectId,
  fieldKey: string,
  session: ClientSession,
): Promise<void> => {
  const field = `persona.${fieldKey}`;
  await connection.collection('crm_audit_logs').updateMany(
    { customerId, 'changes.field': field },
    [
      {
        $set: {
          changes: {
            $map: {
              input: '$changes',
              as: 'change',
              in: {
                $cond: [
                  { $eq: ['$$change.field', field] },
                  {
                    field: '$$change.field',
                    from: redactValue('$$change.from'),
                    to: redactValue('$$change.to'),
                  },
                  '$$change',
                ],
              },
            },
          },
        },
      },
    ],
    { session },
  );
};
