import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../api';
import { statusParamFromSelection, type StatusFilterValue } from '../../../statusFilter';

export type UseVoiceStatusMatchParams = {
  modId: number;
  srcLang: string;
  targetLang: string;
  selectedStatuses: StatusFilterValue[];
  qaOnly: boolean;
};

/**
 * Same string IDs the translation grid would show for the current status / QA filter.
 */
export const useVoiceStatusMatch = ({
  modId,
  srcLang,
  targetLang,
  selectedStatuses,
  qaOnly,
}: UseVoiceStatusMatchParams) => {
  const status = statusParamFromSelection(selectedStatuses);
  const enabled = Boolean(status || qaOnly);

  const query = useQuery({
    queryKey: ['voice-status-match', modId, srcLang, targetLang, status ?? '', qaOnly],
    queryFn: () =>
      api.strings.matchingIds({
        modId,
        srcLang,
        targetLang,
        status,
        qaOnly: qaOnly || undefined,
      }),
    enabled,
    staleTime: 15_000,
  });

  const allowedIds = useMemo((): Set<number> | null | undefined => {
    if (!enabled) return null;
    if (!query.data) return undefined;
    return new Set(query.data.ids);
  }, [enabled, query.data]);

  return { allowedIds, isLoading: enabled && query.isPending };
};
