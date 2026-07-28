/**
 * WordPressService unit spec.
 *
 * Service hiện tại là mock: pushToWordPress simulate delay 1s rồi trả
 * random wpPostId 1..100000. Test dùng fake timers để không chờ 1s thật.
 *
 * Lưu ý contract: service chưa gọi axios/HTTP thật đến WordPress — đây là
 * placeholder đang chờ tích hợp thật (gap sẽ ghi nhận trong báo cáo).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { WordPressService } from './wordpress.service';

describe('WordPressService', () => {
  let service: WordPressService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WordPressService],
    }).compile();
    service = module.get<WordPressService>(WordPressService);
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('pushToWordPress', () => {
    it('trả số nguyên wpPostId trong [1, 100000] sau khi await setTimeout 1000ms', async () => {
      // Promise đang chờ setTimeout 1000ms. Fake timer phải advance để resolve.
      const pending = service.pushToWordPress({ title: 'Bài mẫu' });
      // Advance đúng 1000ms để resolve promise setTimeout bên trong service.
      jest.advanceTimersByTime(1000);
      const wpPostId = await pending;

      expect(typeof wpPostId).toBe('number');
      expect(Number.isInteger(wpPostId)).toBe(true);
      expect(wpPostId).toBeGreaterThanOrEqual(1);
      expect(wpPostId).toBeLessThanOrEqual(100000);
    });

    it('mỗi lần gọi trả về ID khác nhau (random, không cố định)', async () => {
      const ids = new Set<number>();
      for (let i = 0; i < 5; i++) {
        const p = service.pushToWordPress({ title: `Bài ${i}` });
        jest.advanceTimersByTime(1000);
        ids.add(await p);
      }
      // Xác suất trùng toàn 5 ID random trong 100000 rất nhỏ; chỉ chck ít nhất 2 giá trị khác nhau.
      expect(ids.size).toBeGreaterThan(1);
    });

    it('log đúng tiêu đề bài viết được push', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');
      const p = service.pushToWordPress({ title: 'Tiêu đề unique-XYZ' });
      jest.advanceTimersByTime(1000);
      await p;

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tiêu đề unique-XYZ'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Job 4 completed'),
      );
      logSpy.mockRestore();
    });
  });
});
