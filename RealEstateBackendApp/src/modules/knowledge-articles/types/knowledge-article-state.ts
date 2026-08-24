/**
 * Pipeline states for Knowledge Articles.
 *
 * State machine:
 *   pending → generating_content → content_ready → generating_image → ready → publishing → published
 *   Any step can transition to `failed`, then retry resumes from the failed step.
 */
export enum KnowledgeArticleState {
  PENDING = 'pending',
  GENERATING_CONTENT = 'generating_content',
  CONTENT_READY = 'content_ready',
  GENERATING_IMAGE = 'generating_image',
  READY = 'ready',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}
