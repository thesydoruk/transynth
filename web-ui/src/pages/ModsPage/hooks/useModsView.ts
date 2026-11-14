import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_MODS_VIEW, parseModsView, writeModsView, type ModsView } from '../modsView';

/** The Mods page view (source, content, status, search, grouping) kept in the URL. */
export const useModsView = () => {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseModsView(params), [params]);

  const setView = useCallback(
    (patch: Partial<ModsView>) => {
      setParams((prev) => writeModsView(prev, patch), { replace: true });
    },
    [setParams],
  );

  /** Clears the filters; the grouping is a layout choice and stays. */
  const resetFilters = useCallback(() => {
    setView({
      source: DEFAULT_MODS_VIEW.source,
      content: DEFAULT_MODS_VIEW.content,
      status: DEFAULT_MODS_VIEW.status,
      q: DEFAULT_MODS_VIEW.q,
    });
  }, [setView]);

  return { view, setView, resetFilters };
};
