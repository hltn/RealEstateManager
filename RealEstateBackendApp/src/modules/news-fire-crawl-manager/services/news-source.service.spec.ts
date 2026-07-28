import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { NewsSourceService } from './news-source.service';
import { NewsSource } from '../schemas/news-source.schema';

/**
 * Unit test cho NewsSourceService — CRUD cơ bản trên Mongoose Model.
 * Mock Mongoose Model theo pattern chainable queries của spec hiện có.
 */
describe('NewsSourceService', () => {
  let service: NewsSourceService;
  let mockNewsSourceModel: any;

  beforeEach(async () => {
    // Mongoose Model là function constructor — new this.newsSourceModel(createDto)
    // phải trả về object có .save(). Dùng jest fn cho cả 2 vai trò.
    mockNewsSourceModel = jest.fn() as any;
    (mockNewsSourceModel as any).find = jest.fn();
    (mockNewsSourceModel as any).findByIdAndUpdate = jest.fn();
    (mockNewsSourceModel as any).findByIdAndDelete = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsSourceService,
        {
          provide: getModelToken(NewsSource.name),
          useValue: mockNewsSourceModel,
        },
      ],
    }).compile();

    service = module.get<NewsSourceService>(NewsSourceService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Helper tạo chainable query mock (exec() trả về giá trị)
  const chainable = (value: any) => ({
    exec: jest.fn().mockResolvedValue(value),
  });

  describe('findAll', () => {
    it('should return all news sources via find().exec()', async () => {
      const sources = [
        { _id: '1', name: 'VnExpress' },
        { _id: '2', name: 'Tuổi Trẻ' },
      ];
      mockNewsSourceModel.find.mockReturnValue(chainable(sources));

      const result = await service.findAll();

      expect(mockNewsSourceModel.find).toHaveBeenCalledWith();
      expect(result).toEqual(sources);
    });
  });

  describe('findActive', () => {
    it('should query only active sources', async () => {
      const active = [{ _id: '1', name: 'VnExpress', isActive: true }];
      mockNewsSourceModel.find.mockReturnValue(chainable(active));

      const result = await service.findActive();

      expect(mockNewsSourceModel.find).toHaveBeenCalledWith({
        isActive: true,
      });
      expect(result).toEqual(active);
    });
  });

  describe('create', () => {
    it('should instantiate a new source and save it', async () => {
      const createDto = { name: 'VnExpress', url: 'https://vnexpress.net' };
      const saved = { _id: 'abc', ...createDto };
      const saveMock = jest.fn().mockResolvedValue(saved);
      // new this.newsSourceModel(createDto) → gọi constructor mock
      mockNewsSourceModel.mockImplementation(function (this: any, dto: any) {
        return { ...dto, save: saveMock };
      });

      const result = await service.create(createDto);

      expect(mockNewsSourceModel).toHaveBeenCalledWith(createDto);
      expect(saveMock).toHaveBeenCalled();
      expect(result).toEqual(saved);
    });
  });

  describe('update', () => {
    it('should return updated document when found', async () => {
      const updated = { _id: '1', name: 'Updated' };
      mockNewsSourceModel.findByIdAndUpdate.mockReturnValue(chainable(updated));

      const result = await service.update('1', { name: 'Updated' });

      expect(mockNewsSourceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        '1',
        { name: 'Updated' },
        { new: true },
      );
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when document not found', async () => {
      mockNewsSourceModel.findByIdAndUpdate.mockReturnValue(chainable(null));

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should return deleted document when found', async () => {
      const deleted = { _id: '1', name: 'VnExpress' };
      mockNewsSourceModel.findByIdAndDelete.mockReturnValue(chainable(deleted));

      const result = await service.remove('1');

      expect(mockNewsSourceModel.findByIdAndDelete).toHaveBeenCalledWith('1');
      expect(result).toEqual(deleted);
    });

    it('should throw NotFoundException when document not found', async () => {
      mockNewsSourceModel.findByIdAndDelete.mockReturnValue(chainable(null));

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
