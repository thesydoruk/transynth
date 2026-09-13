import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mod } from '../../../api';
import { formatModDisplayName, groupModVersions } from '../modVersions';

export const useModSelection = (sortedMods: Mod[]) => {
  const currentMods = useMemo(
    () => groupModVersions(sortedMods).map((group) => group.current),
    [sortedMods],
  );
  const [selectedModIds, setSelectedModIds] = useState<Set<number>>(() => new Set());
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const batchMenuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selectedModCount = selectedModIds.size;
  const multiSelectActive = selectedModCount > 1;
  const allModsSelected =
    currentMods.length > 0 && currentMods.every((mod) => selectedModIds.has(mod.id));
  const someModsSelected = selectedModCount > 0 && !allModsSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someModsSelected;
    }
  }, [someModsSelected]);

  useEffect(() => {
    if (!batchMenuOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!batchMenuRef.current?.contains(ev.target as Node)) {
        setBatchMenuOpen(false);
      }
    };
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [batchMenuOpen]);

  useEffect(() => {
    setSelectedModIds((prev) => {
      const valid = new Set(sortedMods.map((mod) => mod.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sortedMods]);

  const toggleModSelection = useCallback((modId: number, selected: boolean) => {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(modId);
      else next.delete(modId);
      return next;
    });
  }, []);

  const clearModSelection = useCallback(() => {
    setSelectedModIds(new Set());
  }, []);

  const toggleSelectAllMods = useCallback(() => {
    setSelectedModIds((prev) => {
      const currentIds = currentMods.map((mod) => mod.id);
      const allCurrent = currentIds.every((id) => prev.has(id));
      return allCurrent ? new Set() : new Set(currentIds);
    });
  }, [currentMods]);

  const selectedModsForDelete = useCallback(() => {
    const selected = sortedMods.filter((mod) => selectedModIds.has(mod.id));
    return selected.map((mod) => ({ id: mod.id, name: formatModDisplayName(mod) }));
  }, [sortedMods, selectedModIds]);

  return {
    selectedModIds,
    batchMenuOpen,
    setBatchMenuOpen,
    batchMenuRef,
    selectAllRef,
    selectedModCount,
    multiSelectActive,
    allModsSelected,
    someModsSelected,
    toggleModSelection,
    clearModSelection,
    toggleSelectAllMods,
    selectedModsForDelete,
  };
};
