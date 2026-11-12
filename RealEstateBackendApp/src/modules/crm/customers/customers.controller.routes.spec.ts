import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CustomerSensitiveDataController } from './customer-sensitive-data.controller';
import { CustomersController } from './customers.controller';

/** Liệt kê "METHOD đường-dẫn-đầy-đủ" của mọi handler bằng metadata NestJS (đúng thứ Swagger/router đọc). */
const routesOf = (controller: { prototype: object }): string[] => {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler = (controller.prototype as Record<string, object>)[name];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      if (method === undefined) return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      return [`${RequestMethod[method]} /${base}/${path}`.replace(/\/+$/, '')];
    });
};

describe('FR-03/FR-20: route phone-lookups đã bị xóa hẳn', () => {
  it('FR-03: CustomersController không còn route phone-lookups; vẫn còn tạo khách và list-counts', () => {
    const routes = routesOf(CustomersController);
    expect(routes.some((route) => route.includes('phone-lookups'))).toBe(false);
    expect(routes).toContain('POST /crm/customers');
    expect(routes).toContain('GET /crm/customers/list-counts');
  });

  it('FR-03: controller dữ liệu nhạy cảm không có phone-lookups; phone-views vẫn còn', () => {
    const routes = routesOf(CustomerSensitiveDataController);
    expect(routes.some((route) => route.includes('phone-lookups'))).toBe(false);
    expect(routes).toContain('POST /crm/customers/:id/phone-views');
  });
});
