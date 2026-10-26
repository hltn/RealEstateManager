export const LOCK_OWNER_ENV: string;
export function acquireRunLock(lockDir: string, env?: NodeJS.ProcessEnv): () => void;
