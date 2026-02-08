import { buildIssuesText, parseErrorIssuesJson, getSyncErrorMessage } from '@/src/lib/sync-errors';

export function resolveErrorCopy(errorStatus?: number | null): {
  title: string;
  subtitle: string;
  message: string;
} {
  const ui = getSyncErrorMessage(errorStatus);
  return {
    title: ui.title,
    subtitle: ui.title,
    message: ui.message,
  };
}

export { buildIssuesText, parseErrorIssuesJson };
