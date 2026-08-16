/**
 * KnowledgeConfigService unit tests.
 *
 * Mocks the Mongoose Model and tests:
 * - getConfig: returns config by type, returns null when not found
 * - updateConfig: upserts config document
 * - typed helpers: getWpConfig, getAiWritingConfig, getAiImageConfig, getCronConfig
 */

const mockLean = jest.fn();
const mockExec = jest.fn();
const mockFindOne = jest.fn(() => ({ lean: mockLean }));
const mockFindOneAndUpdate = jest.fn();

const mockConfigModel = {
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
};

import { KnowledgeConfigService } from './knowledge-config.service';
import { KnowledgeConfigType } from '../schemas/knowledge-config.schema';

describe('KnowledgeConfigService', () => {
  let service: KnowledgeConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLean.mockReturnValue({ exec: mockExec });
    mockExec.mockResolvedValue(null);
    service = new KnowledgeConfigService(mockConfigModel as never);
  });

  describe('getConfig', () => {
    it('returns config when found', async () => {
      const fakeConfig = {
        type: KnowledgeConfigType.WP_CONNECTION,
        config: { siteUrl: 'https://example.com' },
      };
      mockExec.mockResolvedValue(fakeConfig);

      const result = await service.getConfig(KnowledgeConfigType.WP_CONNECTION);

      expect(mockFindOne).toHaveBeenCalledWith({
        type: KnowledgeConfigType.WP_CONNECTION,
      });
      expect(result).toEqual(fakeConfig);
    });

    it('returns null when no config found', async () => {
      mockExec.mockResolvedValue(null);

      const result = await service.getConfig(KnowledgeConfigType.AI_WRITING);

      expect(result).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('upserts config and returns updated document', async () => {
      const updated = {
        type: KnowledgeConfigType.AI_IMAGE,
        config: { enabled: true },
      };
      mockFindOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.updateConfig(KnowledgeConfigType.AI_IMAGE, {
        enabled: true,
      });

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { type: KnowledgeConfigType.AI_IMAGE },
        expect.objectContaining({
          type: KnowledgeConfigType.AI_IMAGE,
          config: { enabled: true },
        }),
        { upsert: true, new: true },
      );
      expect(result).toEqual(updated);
    });
  });

  describe('typed helpers', () => {
    it('getWpConfig returns config from wp_connection type', async () => {
      mockExec.mockResolvedValue({
        config: { siteUrl: 'https://test.com' },
      });

      const result = await service.getWpConfig();

      expect(mockFindOne).toHaveBeenCalledWith({
        type: KnowledgeConfigType.WP_CONNECTION,
      });
      expect(result).toEqual({ siteUrl: 'https://test.com' });
    });

    it('getWpConfig returns empty object when no config exists', async () => {
      mockExec.mockResolvedValue(null);

      const result = await service.getWpConfig();

      expect(result).toEqual({});
    });

    it('updateWpConfig upserts wp_connection config', async () => {
      const updated = {
        type: KnowledgeConfigType.WP_CONNECTION,
        config: { siteUrl: 'https://new.com' },
      };
      mockFindOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.updateWpConfig({
        siteUrl: 'https://new.com',
      });

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { type: KnowledgeConfigType.WP_CONNECTION },
        expect.objectContaining({
          type: KnowledgeConfigType.WP_CONNECTION,
          config: { siteUrl: 'https://new.com' },
        }),
        { upsert: true, new: true },
      );
      expect(result).toEqual(updated);
    });

    it('getAiWritingConfig returns config from ai_writing type', async () => {
      mockExec.mockResolvedValue({
        config: { promptTemplate: 'Write about {{topic}}' },
      });

      const result = await service.getAiWritingConfig();

      expect(mockFindOne).toHaveBeenCalledWith({
        type: KnowledgeConfigType.AI_WRITING,
      });
      expect(result).toEqual({ promptTemplate: 'Write about {{topic}}' });
    });

    it('updateAiWritingConfig upserts ai_writing config', async () => {
      const updated = {
        type: KnowledgeConfigType.AI_WRITING,
        config: { promptTemplate: 'New template' },
      };
      mockFindOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.updateAiWritingConfig({
        promptTemplate: 'New template',
      });

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { type: KnowledgeConfigType.AI_WRITING },
        expect.objectContaining({ type: KnowledgeConfigType.AI_WRITING }),
        { upsert: true, new: true },
      );
      expect(result).toEqual(updated);
    });

    it('getAiImageConfig returns config from ai_image type', async () => {
      mockExec.mockResolvedValue({
        config: { enabled: false },
      });

      const result = await service.getAiImageConfig();

      expect(result).toEqual({ enabled: false });
    });

    it('updateAiImageConfig upserts ai_image config', async () => {
      const updated = {
        type: KnowledgeConfigType.AI_IMAGE,
        config: { enabled: true },
      };
      mockFindOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.updateAiImageConfig({ enabled: true });

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { type: KnowledgeConfigType.AI_IMAGE },
        expect.objectContaining({ type: KnowledgeConfigType.AI_IMAGE }),
        { upsert: true, new: true },
      );
      expect(result).toEqual(updated);
    });

    it('getCronConfig returns config from cron type', async () => {
      mockExec.mockResolvedValue({
        config: { isActive: true, frequency: '0 8 * * *' },
      });

      const result = await service.getCronConfig();

      expect(result).toEqual({ isActive: true, frequency: '0 8 * * *' });
    });

    it('updateCronConfig upserts cron config', async () => {
      const updated = {
        type: KnowledgeConfigType.CRON,
        config: { isActive: true, frequency: '0 9 * * *' },
      };
      mockFindOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.updateCronConfig({
        isActive: true,
        frequency: '0 9 * * *',
      });

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { type: KnowledgeConfigType.CRON },
        expect.objectContaining({ type: KnowledgeConfigType.CRON }),
        { upsert: true, new: true },
      );
      expect(result).toEqual(updated);
    });
  });
});
