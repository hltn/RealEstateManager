/**
 * SettingsController unit spec — contract mục 3 (Swagger + API versioning)
 * và mục 1 (RESTful, delegate sang service, không chứa logic).
 *
 * Bao phủ 3 endpoint:
 * - GET /settings/ai-config → delegate getAiConfig.
 * - POST /settings/ai-config → delegate updateAiConfig với body.
 * - GET /settings/openrouter-models → delegate getOpenRouterModels.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('SettingsController (contract mục 1/3)', () => {
  let controller: SettingsController;
  let service: jest.Mocked<SettingsService>;

  beforeEach(async () => {
    service = {
      getAiConfig: jest.fn(),
      updateAiConfig: jest.fn(),
      getOpenRouterModels: jest.fn(),
    } as unknown as jest.Mocked<SettingsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: service }],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
  });

  describe('GET /settings/ai-config', () => {
    it('delegate sang service.getAiConfig, không chứa logic', () => {
      const expected = {
        provider: 'OpenRouter',
        model: 'x',
        apiKey: '***',
        must1cApiKey: '***',
        must1cModel: '',
        activePlatform: 'OpenRouter',
      };
      service.getAiConfig.mockReturnValue(expected);

      const result = controller.getAiConfig();

      expect(service.getAiConfig).toHaveBeenCalledTimes(1);
      expect(service.getAiConfig).toHaveBeenCalledWith();
      expect(result).toBe(expected);
      // Least Privilege: apiKey phải là mask, KHÔNG trả raw.
      expect(result.apiKey).toBe('***');
      expect(result.must1cApiKey).toBe('***');
    });
  });

  describe('POST /settings/ai-config', () => {
    it('delegate sang service.updateAiConfig với body nguyên vẹn', () => {
      const body = {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-new',
      };
      service.updateAiConfig.mockReturnValue({ success: true });

      const result = controller.updateAiConfig(body);

      expect(service.updateAiConfig).toHaveBeenCalledWith(body);
      expect(result).toEqual({ success: true });
    });

    it('body rỗng (field optional) vẫn delegate', () => {
      service.updateAiConfig.mockReturnValue({ success: true });
      const result = controller.updateAiConfig({});

      expect(service.updateAiConfig).toHaveBeenCalledWith({});
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /settings/openrouter-models', () => {
    it('delegate sang service.getOpenRouterModels (async)', async () => {
      const expected = { data: [{ id: 'gpt' }] };
      service.getOpenRouterModels.mockResolvedValue(expected);

      const result = await controller.getOpenRouterModels();

      expect(service.getOpenRouterModels).toHaveBeenCalledTimes(1);
      expect(result).toBe(expected);
    });

    it('propagate lỗi khi service throw (controller không nuốt)', async () => {
      service.getOpenRouterModels.mockRejectedValue(
        new Error('OpenRouter API key is not configured'),
      );
      await expect(controller.getOpenRouterModels()).rejects.toThrow(
        'OpenRouter API key is not configured',
      );
    });
  });

  describe('@Roles metadata — RBAC matrix mục 11', () => {
    it('getAiConfig có @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, SettingsController.prototype.getAiConfig);
      expect(roles).toEqual([UserRole.ADMIN]);
    });

    it('updateAiConfig có @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, SettingsController.prototype.updateAiConfig);
      expect(roles).toEqual([UserRole.ADMIN]);
    });

    it('getOpenRouterModels có @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, SettingsController.prototype.getOpenRouterModels);
      expect(roles).toEqual([UserRole.ADMIN]);
    });
  });
});
