/**
 * Pipeline step types for progress tracking.
 */
export interface PipelineStepInfo {
  step: number;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export const PIPELINE_STEPS: PipelineStepInfo[] = [
  { step: 1, label: 'Chọn topics', status: 'pending' },
  { step: 2, label: 'AI viết bài', status: 'pending' },
  { step: 3, label: 'AI sinh ảnh', status: 'pending' },
  { step: 4, label: 'Upload media', status: 'pending' },
  { step: 5, label: 'Đăng WP', status: 'pending' },
];
