import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  describe('getHello', () => {
    it('trả về chuỗi "Hello World!"', () => {
      expect(service.getHello()).toBe('Hello World!');
    });

    it('luôn trả về giá trị cố định (deterministic, không random)', () => {
      expect(service.getHello()).toBe(service.getHello());
    });
  });
});
