import { Test, TestingModule } from '@nestjs/testing';
import { NlCronService } from './nl-cron.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PipelineService } from './pipeline.service';

describe('NlCronService', () => {
  let service: NlCronService;
  let configService: KnowledgeConfigService;

  const mockCronConfig = {
    isActive: false,
    frequency: '',
    nlDescription: '',
    parsedCron: '',
    lastRunAt: null,
    nextRunAt: null,
  };

  beforeEach(async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NlCronService,
        {
          provide: KnowledgeConfigService,
          useValue: {
            getCronConfig: jest.fn().mockResolvedValue(mockCronConfig),
            getAiWritingConfig: jest.fn().mockResolvedValue({
              provider: 'OpenRouter',
              model: 'google/gemini-2.5-flash',
            }),
            updateCronConfig: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: SchedulerRegistry,
          useValue: {
            addCronJob: jest.fn(),
            deleteCronJob: jest.fn(),
            getCronJob: jest.fn(),
          },
        },
        {
          provide: PipelineService,
          useValue: {
            startPipeline: jest.fn().mockResolvedValue({
              message: 'Pipeline started',
              jobId: 'test-job',
            }),
            isPipelineRunning: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<NlCronService>(NlCronService);
    configService = module.get<KnowledgeConfigService>(KnowledgeConfigService);
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseDescription', () => {
    it('should parse NL description to cron via AI', async () => {
      const aiResponse = {
        cron: '0 8 * * 1-5',
        explanation: 'Thứ 2-6, 8:00 sáng',
        schedule: {
          frequency: 'weekdays',
          time: '08:00',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        articlesPerBatch: 3,
        categories: ['ha-noi', 'hcm'],
      };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify(aiResponse) } },
          ],
        }),
      } as any);

      const result = await service.parseDescription(
        'Chạy hàng ngày lúc 8h sáng từ thứ 2 đến thứ 6',
      );

      expect(result.cronExpression).toBe('0 8 * * 1-5');
      expect(result.explanation).toContain('Thứ 2-6');
      expect(result.schedule.frequency).toBe('weekdays');
      expect(result.articlesPerBatch).toBe(3);
      expect(result.categories).toEqual(['ha-noi', 'hcm']);

      global.fetch = originalFetch;
    });

    it('should default articlesPerBatch to 3 when not provided', async () => {
      const aiResponse = {
        cron: '0 8 * * *',
        explanation: 'Mỗi ngày 8h sáng',
        schedule: {
          frequency: 'daily',
          time: '08:00',
          timezone: 'Asia/Ho_Chi_Minh',
        },
      };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify(aiResponse) } },
          ],
        }),
      } as any);

      const result = await service.parseDescription('Mỗi ngày 8h sáng');

      expect(result.articlesPerBatch).toBe(3);
      expect(result.categories).toEqual([]);

      global.fetch = originalFetch;
    });

    it('should throw on empty AI response', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }],
        }),
      } as any);

      await expect(
        service.parseDescription('test'),
      ).rejects.toThrow('empty');

      global.fetch = originalFetch;
    });

    it('should throw on invalid cron expression from AI', async () => {
      const aiResponse = {
        cron: 'invalid-cron',
        explanation: 'Test',
        schedule: { frequency: 'daily', time: '08:00', timezone: 'Asia/Ho_Chi_Minh' },
      };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify(aiResponse) } },
          ],
        }),
      } as any);

      await expect(
        service.parseDescription('test'),
      ).rejects.toThrow();

      global.fetch = originalFetch;
    });

    it('should throw on API error', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      } as any);

      await expect(
        service.parseDescription('test'),
      ).rejects.toThrow('429');

      global.fetch = originalFetch;
    });
  });

  describe('previewSchedule', () => {
    it('should return next 5 runs for a valid cron expression', () => {
      const result = service.previewSchedule('0 8 * * 1-5');

      expect(result.nextRuns.length).toBe(5);
      result.nextRuns.forEach((run) => {
        expect(new Date(run).toISOString()).toBe(run);
      });
    });

    it('should throw on invalid cron expression', () => {
      expect(() => {
        service.previewSchedule('invalid');
      }).toThrow('Expected 5 fields');
    });

    it('should throw on cron with invalid characters', () => {
      expect(() => {
        service.previewSchedule('abc def ghi jkl mno');
      }).toThrow();
    });

    it('should throw on out-of-range minute', () => {
      expect(() => {
        service.previewSchedule('70 8 * * *');
      }).toThrow('Minute out of range');
    });

    it('should throw on out-of-range hour', () => {
      expect(() => {
        service.previewSchedule('0 25 * * *');
      }).toThrow('Hour out of range');
    });

    it('should validate with comma-separated fields', () => {
      const result = service.previewSchedule('0 8,12,18 * * *');
      expect(result.nextRuns.length).toBe(5);
    });

    it('should validate with step fields', () => {
      const result = service.previewSchedule('0 */2 * * *');
      expect(result.nextRuns.length).toBe(5);
    });
  });

  describe('activateSchedule', () => {
    it('should save config and register cron job', async () => {
      const result = await service.activateSchedule(
        '0 8 * * 1-5',
        'Chạy hàng ngày 8h sáng từ T2-T6',
      );

      expect(result.message).toContain('activated');
      expect(result.nextRuns.length).toBe(5);
      expect(configService.updateCronConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          frequency: '0 8 * * 1-5',
        }),
      );
    });

    it('should throw on invalid cron expression', async () => {
      await expect(
        service.activateSchedule('invalid', 'test'),
      ).rejects.toThrow();
    });

    it('should update nextRunAt in config', async () => {
      await service.activateSchedule(
        '0 8 * * *',
        'Daily 8am',
      );

      expect(configService.updateCronConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          nextRunAt: expect.any(String),
        }),
      );
    });
  });

  describe('deactivateSchedule', () => {
    it('should deactivate and update config', async () => {
      await service.deactivateSchedule();

      expect(configService.updateCronConfig).toHaveBeenCalledWith({
        isActive: false,
      });
    });
  });

  describe('getScheduleStatus', () => {
    it('should return current schedule status', async () => {
      const status = await service.getScheduleStatus();

      expect(status).toHaveProperty('isActive');
      expect(status).toHaveProperty('cronExpression');
      expect(status).toHaveProperty('nlDescription');
      expect(status).toHaveProperty('lastRunAt');
      expect(status).toHaveProperty('nextRunAt');
      expect(status).toHaveProperty('isRunning');
      expect(status.isRunning).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('should restore cron schedule from config when active', async () => {
      (configService.getCronConfig as jest.Mock).mockResolvedValue({
        isActive: true,
        parsedCron: '0 8 * * *',
      });

      await service.onModuleInit();

      // Should attempt to register cron job
    });

    it('should not restore when config is inactive', async () => {
      (configService.getCronConfig as jest.Mock).mockResolvedValue({
        isActive: false,
        parsedCron: '',
      });

      await service.onModuleInit();
      // Should not throw
    });

    it('should not throw on init errors', async () => {
      (configService.getCronConfig as jest.Mock).mockRejectedValue(
        new Error('DB connection failed'),
      );

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
