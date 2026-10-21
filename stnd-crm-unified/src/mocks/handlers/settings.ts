import type { AiConfigResponse, OpenRouterModel } from '../../api/settings.api';
import type { MockRoute } from '../types';
import { ok } from '../utils';
import { asRecord } from './shared';

/** Che API key giống backend (chỉ để UI biết "đã cấu hình", không bao giờ trả key thật). */
const maskKey = (key: string): string => (key ? `${key.slice(0, 6)}••••••••` : '');

/** Cấu hình AI hiện tại — key lưu ở dạng đã che sẵn (prototype không có key thật). */
let aiConfig: AiConfigResponse = {
  apiKey: 'sk-or-••••••••',
  provider: 'openai',
  model: 'openai/gpt-4o-mini',
  must1cApiKey: 'm1c-••••••••',
  must1cModel: 'gpt-4o',
  nineRouterBaseUrl: 'https://9router.stnd.vn/v1',
  nineRouterApiKey: '',
  nineRouterModel: '',
  activePlatform: 'OpenRouter',
};

const OPENROUTER_MODELS: OpenRouterModel[] = [
  { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o mini' },
  { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
  { id: 'openai/gpt-4.1', name: 'OpenAI: GPT-4.1' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic: Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3.5-haiku', name: 'Anthropic: Claude 3.5 Haiku' },
  { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek: DeepSeek V3' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Meta: Llama 3.3 70B Instruct' },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen2.5 72B Instruct' },
];

const NINE_ROUTER_MODELS: OpenRouterModel[] = [
  { id: 'cc/claude-sonnet-4', name: 'Claude Sonnet 4 (9Router)' },
  { id: 'gh/gpt-4.1', name: 'GPT-4.1 (9Router)' },
  { id: 'gc/gemini-2.5-pro', name: 'Gemini 2.5 Pro (9Router)' },
  { id: 'qw/qwen3-coder', name: 'Qwen3 Coder (9Router)' },
];

/** Các field chuỗi được phép ghi từ `POST /settings/ai-config`. */
const STRING_FIELDS = [
  'provider',
  'model',
  'must1cModel',
  'nineRouterBaseUrl',
  'nineRouterModel',
  'activePlatform',
] as const satisfies readonly (keyof AiConfigResponse)[];

/** Field là API key — lưu dạng đã che; giá trị `***` (UI gửi lại khi không đổi) thì bỏ qua. */
const KEY_FIELDS = ['apiKey', 'must1cApiKey', 'nineRouterApiKey'] as const satisfies readonly (keyof AiConfigResponse)[];

/** `/settings/*` — cấu hình AI (OpenRouter / Must1c / 9Router) và danh sách model. */
export const settingsRoutes: MockRoute[] = [
  { method: 'GET', pattern: /^\/settings\/ai-config$/, handler: () => ok(aiConfig) },
  {
    method: 'POST',
    pattern: /^\/settings\/ai-config$/,
    handler: ({ body }) => {
      const payload = asRecord(body);
      const next: AiConfigResponse = { ...aiConfig };
      STRING_FIELDS.forEach((field) => {
        const value = payload[field];
        if (typeof value === 'string') next[field] = value;
      });
      KEY_FIELDS.forEach((field) => {
        const value = payload[field];
        if (typeof value === 'string' && value && !value.includes('*')) next[field] = maskKey(value);
      });
      aiConfig = next;
      return ok({ message: 'Đã lưu cấu hình AI', data: aiConfig });
    },
  },
  { method: 'GET', pattern: /^\/settings\/openrouter-models$/, handler: () => ok({ data: OPENROUTER_MODELS }) },
  { method: 'GET', pattern: /^\/settings\/9router-models$/, handler: () => ok({ models: NINE_ROUTER_MODELS }) },
];
