import { createCustomerCodeIndex } from '../customer-code-index';
import type { Migration } from '../migration.types';

/**
 * Migration 010 (FR-07, FR-21), pha `pre-up` (mặc định): chỉ THÊM (expand), tương thích image cũ còn phục vụ giữa
 * bước 6b và `up`. Logic ở `customer-code-index.ts` (kiểm thử ở đó và ở integration); file này nối vào runner.
 * Không có `down`: index/counter không gây hại nếu để lại.
 */
export const migration010CrmCustomerCodeIndex: Migration = {
  id: '010_crm_customer_code_index',
  description:
    'Tạo index partial unique customers.customerCode_1 (chỉ tính mã dạng chuỗi) và upsert counter CUSTOMER_CODE (seq 0); không bù mã, không đụng phone',
  up: async ({ db, log }) => {
    await createCustomerCodeIndex(db, log);
  },
};
