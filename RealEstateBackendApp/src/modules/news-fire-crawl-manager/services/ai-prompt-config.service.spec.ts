jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  promises: { writeFile: jest.fn() },
}));
// Service resolve path bằng `path.resolve(__dirname, '..', 'constants', 'ai-prompts.json')`
// (commit c66885f chuyển từ process.cwd() sang __dirname). Mock phải cung cấp
// cả `resolve` để reflect contract thật — không chỉ `join`.
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  resolve: jest.fn((...args: string[]) => args.join('/')),
  sep: '/',
}));

import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import { AiPromptConfigService } from './ai-prompt-config.service';

/**
 * Unit test cho AiPromptConfigService — service load/save prompt từ file JSON.
 * Mock fs để tránh phụ thuộc file thật trên đĩa.
 */
describe('AiPromptConfigService', () => {
  let service: AiPromptConfigService;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Cấu hình mặc định: file tồn tại, có 2 prompts
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify([
        { api_ai_name: 'FILTER_AND_RANK_PROMPT', prompt: 'filter prompt' },
        { api_ai_name: 'CLEAN_ARTICLE_PROMPT', prompt: 'clean prompt' },
      ]),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiPromptConfigService],
    }).compile();

    service = module.get<AiPromptConfigService>(AiPromptConfigService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should load prompts from JSON file when exists', () => {
      service.onModuleInit();

      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.readFileSync).toHaveBeenCalled();
      expect(service.getPrompts()).toHaveLength(2);
    });

    it('should fallback to empty array when file not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      service.onModuleInit();

      expect(service.getPrompts()).toEqual([]);
    });

    it('should swallow parse error and keep prompts as-is', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not-json');

      // Sau khi đổi console.error → Logger, không còn spy console.
      // Chỉ verify không throw (loadPrompts catch + log, không crash).
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe('getPromptByName', () => {
    it('should return prompt text when name matches', () => {
      service.onModuleInit();

      expect(service.getPromptByName('FILTER_AND_RANK_PROMPT')).toBe(
        'filter prompt',
      );
    });

    it('should return empty string when name not found', () => {
      service.onModuleInit();

      expect(service.getPromptByName('NON_EXISTENT')).toBe('');
    });
  });

  describe('getPrompts', () => {
    it('should return the loaded prompts array', () => {
      service.onModuleInit();

      const prompts = service.getPrompts();
      expect(prompts).toHaveLength(2);
      expect(prompts[0].api_ai_name).toBe('FILTER_AND_RANK_PROMPT');
    });
  });

  describe('updatePrompts', () => {
    it('should persist new prompts to file', async () => {
      const newPrompts = [
        { api_ai_name: 'NEW_PROMPT', prompt: 'new', api_ai_path: '' },
      ];

      const result = await service.updatePrompts(newPrompts);

      expect(result).toBeUndefined();
      expect(fs.promises.writeFile).toHaveBeenCalled();
      // Trạng thái in-memory cập nhật ngay cả trước khi file ghi xong
      expect(service.getPrompts()).toEqual(newPrompts);
    });

    it('should throw InternalServerErrorException when writeFile fails', async () => {
      (fs.promises.writeFile as jest.Mock).mockRejectedValueOnce(
        new Error('disk full'),
      );

      await expect(
        service.updatePrompts([
          { api_ai_name: 'X', prompt: 'y', api_ai_path: '' },
        ]),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should rollback in-memory prompts when writeFile fails (chống race state lệch)', async () => {
      // Load prompts ban đầu (2 prompts) — onModuleInit set state cũ.
      service.onModuleInit();
      const before = service.getPrompts();

      (fs.promises.writeFile as jest.Mock).mockRejectedValueOnce(
        new Error('disk full'),
      );

      await expect(
        service.updatePrompts([
          { api_ai_name: 'FAIL', prompt: 'x', api_ai_path: '' },
        ]),
      ).rejects.toThrow(InternalServerErrorException);

      // Rollback: state in-memory phải về giá trị cũ, KHÔNG giữ payload lỗi.
      expect(service.getPrompts()).toEqual(before);
      expect(
        service.getPrompts().some((p) => p.api_ai_name === 'FAIL'),
      ).toBe(false);
    });
  });
});
