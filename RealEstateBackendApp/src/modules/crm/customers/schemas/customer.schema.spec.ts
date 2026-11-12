import { model, Types } from 'mongoose';
import { CUSTOMER_CODE_INDEX } from '../customer-code.constants';
import { CustomerSchema } from './customer.schema';

/** Model gắn vào schema thật, không cần kết nối DB: chỉ kiểm default/validator chạy ở `validate()`. */
const CustomerModel = model('CustomerSchemaSpec', CustomerSchema);

/** Bộ field bắt buộc tối thiểu của một khách (không gồm `phone`, `customerCode`). */
const build = (fields: Record<string, unknown> = {}) =>
  new CustomerModel({
    fullName: 'Nguyễn Văn A',
    statusId: new Types.ObjectId(),
    statusChangedAt: new Date(),
    lastUpdatedAt: new Date(),
    lastUpdatedBy: new Types.ObjectId(),
    ...fields,
  });

/** Danh sách `[key, options]` của mọi index khai báo trong schema. */
const indexes = () => CustomerSchema.indexes();

describe('Customer schema (T-04, FR-01, FR-02, FR-07)', () => {
  describe('phone nullable (FR-01, FR-02)', () => {
    it('FR-01: tạo khách KHÔNG truyền phone vẫn hợp lệ và phone mặc định null', async () => {
      const customer = build();
      await expect(customer.validate()).resolves.toBeUndefined();
      expect(customer.phone).toBeNull();
    });

    it('FR-01: phone = null tường minh hợp lệ', async () => {
      const customer = build({ phone: null });
      await expect(customer.validate()).resolves.toBeUndefined();
      expect(customer.phone).toBeNull();
    });

    it('FR-02: phone có giá trị vẫn được giữ nguyên (không ép null)', async () => {
      const customer = build({ phone: '+84901234567' });
      await expect(customer.validate()).resolves.toBeUndefined();
      expect(customer.phone).toBe('+84901234567');
    });

    it('FR-02: hai khách cùng phone không bị schema chặn (trùng SĐT được phép)', async () => {
      const [a, b] = [
        build({ phone: '+84901234567' }),
        build({ phone: '+84901234567' }),
      ];
      await expect(a.validate()).resolves.toBeUndefined();
      await expect(b.validate()).resolves.toBeUndefined();
    });

    it('FR-01: họ tên vẫn bắt buộc (chỉ phone được nới)', async () => {
      await expect(build({ fullName: undefined }).validate()).rejects.toThrow(
        /fullName/,
      );
    });
  });

  describe('không còn unique phone (FR-02)', () => {
    it('FR-02: không có index nào có khóa phone (phone_1 do migration 011 sở hữu)', () => {
      const phoneIndexes = indexes().filter(([key]) => 'phone' in key);
      expect(phoneIndexes).toEqual([]);
    });

    it('FR-02: path phone không đặt unique/index ở mức Prop', () => {
      const options = CustomerSchema.path('phone').options;
      expect(options.unique).toBeUndefined();
      expect(options.index).toBeUndefined();
    });

    it('FR-02: không index unique nào khác dính tới phone', () => {
      const uniquePhone = indexes().filter(
        ([key, opts]) => opts.unique === true && 'phone' in key,
      );
      expect(uniquePhone).toHaveLength(0);
    });
  });

  describe('customerCode (FR-07)', () => {
    it('FR-07: khách chưa có mã vẫn hợp lệ (bản ghi cũ/image cũ chưa bù mã), customerCode mặc định null', async () => {
      const customer = build();
      await expect(customer.validate()).resolves.toBeUndefined();
      expect(customer.customerCode).toBeNull();
    });

    it('FR-07: customerCode có giá trị được lưu nguyên', async () => {
      const customer = build({ customerCode: 'KH-000001' });
      await expect(customer.validate()).resolves.toBeUndefined();
      expect(customer.customerCode).toBe('KH-000001');
    });

    it('FR-07: index customerCode trong schema khớp từng tùy chọn với CUSTOMER_CODE_INDEX (tránh IndexOptionsConflict)', () => {
      const found = indexes().filter(([key]) => 'customerCode' in key);
      // Đúng một khai báo, không trùng lặp.
      expect(found).toHaveLength(1);
      const [key, options] = found[0];
      expect(key).toEqual(CUSTOMER_CODE_INDEX.key);
      expect(options).toEqual(CUSTOMER_CODE_INDEX.options);
    });

    it('FR-07: index mã là unique + partial theo $type string (khách chưa mã không bị chặn)', () => {
      const [, options] = indexes().find(([key]) => 'customerCode' in key)!;
      expect(options.unique).toBe(true);
      expect(options.partialFilterExpression).toEqual({
        customerCode: { $type: 'string' },
      });
    });

    it('FR-07: schema không khai báo unique/index ở mức Prop cho customerCode (chỉ qua CUSTOMER_CODE_INDEX)', () => {
      const options = CustomerSchema.path('customerCode').options;
      expect(options.unique).toBeUndefined();
      expect(options.index).toBeUndefined();
    });
  });
});
