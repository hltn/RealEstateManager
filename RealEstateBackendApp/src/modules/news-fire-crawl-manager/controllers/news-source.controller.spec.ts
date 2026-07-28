/**
 * NewsSourceController unit spec — contract mục 2 (Response Format phân trang)
 * và RESTful CRUD cho /news-sources.
 *
 * Bao phủ:
 * - GET /news-sources → trả { data, meta: { total, page, limit, totalPages } }.
 * - POST /news-sources → gọi service.create(dto), trả { message, data }.
 * - PUT /news-sources/:id → gọi service.update(id, dto).
 * - DELETE /news-sources/:id → gọi service.remove(id).
 *
 * Controller chỉ delegate — mọi logic nằm ở NewsSourceService (mock boundary).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NewsSourceController } from './news-source.controller';
import { NewsSourceService } from '../services/news-source.service';

describe('NewsSourceController', () => {
  let controller: NewsSourceController;
  let newsSourceService: jest.Mocked<NewsSourceService>;

  beforeEach(async () => {
    newsSourceService = {
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<NewsSourceService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NewsSourceController],
      providers: [{ provide: NewsSourceService, useValue: newsSourceService }],
    }).compile();

    controller = module.get<NewsSourceController>(NewsSourceController);
  });

  describe('GET /news-sources', () => {
    it('trả { data, meta } với meta đúng shape phân trang chuẩn', async () => {
      const sources = [
        { _id: '1', name: 'S1', url: 'https://s1.example' },
        { _id: '2', name: 'S2', url: 'https://s2.example' },
      ];
      newsSourceService.findAll.mockResolvedValue(sources as any);

      const result = await controller.findAll();

      expect(newsSourceService.findAll).toHaveBeenCalledWith();
      expect(result).toEqual({
        data: sources,
        meta: { total: 2, page: 1, limit: 2, totalPages: 1 },
      });
    });

    it('khi không có source → meta total=0, totalPages=1 (controller hardcode totalPages=1)', async () => {
      newsSourceService.findAll.mockResolvedValue([]);
      const result = await controller.findAll();
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 0, totalPages: 1 });
    });
  });

  describe('POST /news-sources', () => {
    it('gọi service.create(dto) và trả { message, data }', async () => {
      const dto = { name: 'New', url: 'https://new.example', rssUrl: 'https://new.example/rss' };
      const created = { _id: '9', ...dto };
      newsSourceService.create.mockResolvedValue(created as any);

      const result = await controller.create(dto as any);

      expect(newsSourceService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Source created successfully', data: created });
    });
  });

  describe('PUT /news-sources/:id', () => {
    it('gọi service.update(id, dto) và trả { message, data }', async () => {
      const dto = { isActive: false };
      const updated = { _id: '1', name: 'S1', url: 'https://s1.example', isActive: false };
      newsSourceService.update.mockResolvedValue(updated as any);

      const result = await controller.update('1', dto as any);

      expect(newsSourceService.update).toHaveBeenCalledWith('1', dto);
      expect(result).toEqual({ message: 'Source updated successfully', data: updated });
    });
  });

  describe('DELETE /news-sources/:id', () => {
    it('gọi service.remove(id) và trả { message, data }', async () => {
      const deleted = { _id: '1', name: 'S1', url: 'https://s1.example' };
      newsSourceService.remove.mockResolvedValue(deleted as any);

      const result = await controller.remove('1');

      expect(newsSourceService.remove).toHaveBeenCalledWith('1');
      expect(result).toEqual({ message: 'Source deleted successfully', data: deleted });
    });
  });
});
