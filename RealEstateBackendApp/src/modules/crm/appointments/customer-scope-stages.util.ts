import { PipelineStage } from 'mongoose';
import { AccessContext } from '../customers/access/customer-access.service';
import { CustomersRepository } from '../customers/customers.repository';

/** Tên collection `customers` cho `$lookup` (schema khách khai báo cùng tên). */
const CUSTOMERS_COLLECTION = 'customers';

/**
 * Giữ lại các bản ghi (lịch hẹn, nhật ký...) chỉ khi KHÁCH của chúng nằm trong phạm vi người gọi và chưa xóa mềm:
 * một `$lookup` có bộ lọc phạm vi dựng từ `CustomersRepository.buildFilter` nên dữ liệu của khách ngoài phạm vi không
 * bao giờ lọt ra. Kết quả: mảng `customer` (đúng 1 phần tử, chỉ gồm các field trong `project`) trên mỗi bản ghi.
 */
export const customerScopeStages = (
  repo: CustomersRepository,
  ctx: AccessContext,
  project: Record<string, 1>,
  customerIdField = '$customerId',
): PipelineStage[] => [
  {
    $lookup: {
      from: CUSTOMERS_COLLECTION,
      let: { customerId: customerIdField },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$customerId'] } } },
        { $match: repo.buildFilter(ctx.scope) },
        { $project: project },
      ],
      as: 'customer',
    },
  },
  { $match: { 'customer.0': { $exists: true } } },
];
