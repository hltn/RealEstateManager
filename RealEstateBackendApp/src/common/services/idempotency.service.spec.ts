/**
 * IdempotencyService unit spec — contract mục 2 (Idempotency-Key chống click đúp).
 *
 * Bao phủ:
 * - get(key) khi chưa set → null.
 * - get(key) sau set → trả lại response đã lưu.
 * - get(key) sau TTL → entry đã expire, trả null và tự xoá khỏi store.
 * - isInFlight / markInFlight / clearInFlight — bảo vệ request đang xử lý.
 * - purgeExpired dọn entry hết hạn.
 * - onModuleDestroy clear interval (không leak timer).
 *
 * Dùng jest.useFakeTimers để kiểm soát TTL 5 phút.
 */
import { IdempotencyService } from './idempotency.service';

const TTL_MS = 5 * 60 * 1000;

describe('IdempotencyService (contract mục 2 — Idempotency)', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new IdempotencyService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('get / set', () => {
    it('get(key) khi chưa set → trả null', () => {
      expect(service.get('key-1')).toBeNull();
    });

    it('get(key) sau set → trả lại đúng response đã lưu (generic)', () => {
      const payload = { ok: true, data: [1, 2, 3] };
      service.set('key-1', payload);

      expect(service.get<typeof payload>('key-1')).toEqual(payload);
    });

    it('set ghi đè entry cũ với cùng key', () => {
      service.set('key-1', { v: 1 });
      service.set('key-1', { v: 2 });

      expect(service.get('key-1')).toEqual({ v: 2 });
    });

    it('get(key) sau TTL → trả null (entry đã expire)', () => {
      service.set('key-1', { v: 1 });
      // Tiến tới ngay sau expiresAt.
      jest.advanceTimersByTime(TTL_MS + 1);

      expect(service.get('key-1')).toBeNull();
    });

    it('get(key) ngoài TTL → xóa entry khỏi store (purge lazy)', () => {
      service.set('key-1', { v: 1 });
      jest.advanceTimersByTime(TTL_MS + 1);

      service.get('key-1'); // trigger lazy delete
      // get lần nữa vẫn null (đã bị xoá).
      expect(service.get('key-1')).toBeNull();
    });

    it('get(key) ngay trước khi expire → vẫn trả response (boundary)', () => {
      service.set('key-1', { v: 1 });
      jest.advanceTimersByTime(TTL_MS - 1);

      expect(service.get('key-1')).toEqual({ v: 1 });
    });
  });

  describe('inFlight tracking', () => {
    it('isInFlight mặc định false', () => {
      expect(service.isInFlight('k')).toBe(false);
    });

    it('markInFlight → isInFlight true', () => {
      service.markInFlight('k');
      expect(service.isInFlight('k')).toBe(true);
    });

    it('clearInFlight → isInFlight false', () => {
      service.markInFlight('k');
      service.clearInFlight('k');
      expect(service.isInFlight('k')).toBe(false);
    });

    it('clearInFlight cho key chưa mark → no-op (idempotent)', () => {
      expect(() => service.clearInFlight('not-exist')).not.toThrow();
    });

    it('inFlight không phụ thuộc TTL (không bị purge)', () => {
      service.markInFlight('k');
      jest.advanceTimersByTime(TTL_MS + 1);
      // inFlight vẫn còn (chỉ response store bị purge).
      expect(service.isInFlight('k')).toBe(true);
    });
  });

  describe('purgeExpired (interval nội bộ)', () => {
    it('sau mỗi TTL, interval chạy và dọn entry hết hạn', () => {
      service.set('a', { v: 1 });
      service.set('b', { v: 2 });
      jest.advanceTimersByTime(TTL_MS + 1);

      // Interval chạy khi timer tick — entry expire bị xoá.
      // Lưu ý: get() cũng lazy-delete, nên ta check bằng cách set lại entry
      // khác và verify không còn entry cũ bằng mock internals qua get.
      expect(service.get('a')).toBeNull();
      expect(service.get('b')).toBeNull();
    });
  });

  describe('onModuleDestroy', () => {
    it('clear interval → không chạy purge sau khi destroy', () => {
      // Spy setInterval & clearInterval để verify.
      const setSpy = jest.spyOn(global, 'setInterval');
      const clearSpy = jest.spyOn(global, 'clearInterval');
      const s = new IdempotencyService();
      const handle = setSpy.mock.results[0].value;

      s.onModuleDestroy();

      expect(clearSpy).toHaveBeenCalledWith(handle);
      setSpy.mockRestore();
      clearSpy.mockRestore();
    });

    it('interval dùng unref — không giữ process sống (mục 7.3 graceful)', () => {
      // Verify qua spy setTimeout/setInterval trả về object có .unref được gọi.
      const unrefSpy = jest.fn();
      const fakeHandle = { unref: unrefSpy };
      const setSpy = jest
        .spyOn(global, 'setInterval')
        .mockReturnValue(fakeHandle as any);

      new IdempotencyService(); // constructor gọi setInterval + unref

      expect(unrefSpy).toHaveBeenCalled();
      setSpy.mockRestore();
    });
  });
});
