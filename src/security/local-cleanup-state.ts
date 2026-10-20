let cleanupInProgress = false;

export function beginLocalCleanup(): void {
  if (cleanupInProgress) throw new Error('LOCAL_CLEANUP_ALREADY_RUNNING');
  cleanupInProgress = true;
}

export function endLocalCleanup(): void {
  cleanupInProgress = false;
}

export function assertLocalWriteAllowed(): void {
  if (cleanupInProgress) throw new Error('LOCAL_CLEANUP_IN_PROGRESS');
}

export function isLocalCleanupInProgress(): boolean {
  return cleanupInProgress;
}
