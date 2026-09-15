import { useQuery } from '@tanstack/react-query';
import { api, type QAIssue } from '../../../../../api';

/**
 * QA findings for one dialog line, fetched only while the line is focused.
 *
 * The transcript ships a count per line and nothing else, which is enough to
 * flag a row but not to act on it — the useful part is the message, and the
 * checks that write it are specific: which word fixes a gender the metadata
 * rules out, which English phrase survived. Rather than pull that for every
 * line of a long conversation, the query runs for the row the cursor is on and
 * only when the count says there is something to say.
 */
export const useDialogLineQa = (
  stringId: number,
  targetLang: string,
  { enabled }: { enabled: boolean },
): QAIssue[] => {
  const query = useQuery({
    queryKey: ['dialog-line-qa', stringId, targetLang],
    queryFn: () => api.strings.qa(stringId, targetLang),
    enabled,
    staleTime: 30_000,
  });

  return query.data ?? [];
};
