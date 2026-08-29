import { useMemo, useState } from 'react';
import type { LlmVerifyIssue } from '../../../../api';

export const useAiVerifyApplyState = (issues: LlmVerifyIssue[]) => {
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [appliedIds, setAppliedIds] = useState<Set<number>>(() => new Set());

  const visibleIssues = useMemo(
    () => issues.filter((issue) => !appliedIds.has(issue.stringId)),
    [issues, appliedIds],
  );

  const pendingIssues = useMemo(
    () => visibleIssues.filter((issue) => issue.suggestion),
    [visibleIssues],
  );

  const markApplied = (stringId: number) => {
    setAppliedIds((prev) => new Set(prev).add(stringId));
  };

  return {
    applyingId,
    setApplyingId,
    applyingAll,
    setApplyingAll,
    visibleIssues,
    pendingIssues,
    markApplied,
    setAppliedIds,
  };
};
