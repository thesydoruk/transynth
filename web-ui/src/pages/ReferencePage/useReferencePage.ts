import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ReferenceTranslation } from '../../api';
import { getSrcLang, getTgtLang, modListQueryKey } from '../../langDefaults';

export const REFERENCE_PAGE_SIZE = 100;

/** State and mutations for the per-game reference base page. */
export const useReferencePage = (gameId: string) => {
  const qc = useQueryClient();
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [tgtLang, setTgtLang] = useState(getTgtLang());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [newSource, setNewSource] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editSource, setEditSource] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [promoteModId, setPromoteModId] = useState<number | ''>('');
  const newSourceRef = useRef<HTMLInputElement | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reference'] });

  const { data: mods } = useQuery({
    queryKey: modListQueryKey(gameId, srcLang || getSrcLang(), tgtLang || getTgtLang()),
    queryFn: () => api.mods.list(gameId, srcLang || getSrcLang(), tgtLang || getTgtLang()),
    enabled: !!gameId,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['reference', gameId, srcLang, tgtLang, q, page],
    queryFn: () =>
      api.reference.list({
        game: gameId,
        srcLang: srcLang || undefined,
        tgtLang: tgtLang || undefined,
        q: q || undefined,
        limit: REFERENCE_PAGE_SIZE,
        offset: page * REFERENCE_PAGE_SIZE,
      }),
    enabled: !!gameId,
    placeholderData: keepPreviousData,
  });

  const add = useMutation({
    mutationFn: () =>
      api.reference.add({
        game: gameId,
        srcLang: srcLang || getSrcLang(),
        tgtLang: tgtLang || getTgtLang(),
        sourceText: newSource.trim(),
        translation: newTranslation.trim(),
      }),
    onSuccess: () => {
      setNewSource('');
      setNewTranslation('');
      void invalidate();
    },
  });

  const update = useMutation({
    mutationFn: ({
      id,
      sourceText,
      translation,
    }: {
      id: number;
      sourceText: string;
      translation: string;
    }) => api.reference.update(id, { sourceText, translation }),
    onSuccess: () => {
      cancelEdit();
      void invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.reference.remove(id),
    onSuccess: () => void invalidate(),
  });

  const promote = useMutation({
    mutationFn: () =>
      api.reference.promote({
        modIds: promoteModId === '' ? undefined : [promoteModId],
        targetLang: tgtLang || getTgtLang(),
      }),
    onSuccess: () => void invalidate(),
  });

  const startEdit = (row: ReferenceTranslation) => {
    setEditId(row.id);
    setEditSource(row.source_text);
    setEditTranslation(row.translation);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditSource('');
    setEditTranslation('');
  };

  const saveEdit = () => {
    if (!editId || !editSource.trim() || !editTranslation.trim()) return;
    update.mutate({
      id: editId,
      sourceText: editSource.trim(),
      translation: editTranslation.trim(),
    });
  };

  const setFilter = {
    srcLang: (v: string) => {
      setSrcLang(v);
      setPage(0);
    },
    tgtLang: (v: string) => {
      setTgtLang(v);
      setPage(0);
    },
    q: (v: string) => {
      setQ(v);
      setPage(0);
    },
  };

  return {
    srcLang,
    tgtLang,
    q,
    setFilter,
    page,
    setPage,
    newSource,
    setNewSource,
    newTranslation,
    setNewTranslation,
    newSourceRef,
    editId,
    editSource,
    setEditSource,
    editTranslation,
    setEditTranslation,
    promoteModId,
    setPromoteModId,
    mods,
    data,
    isLoading,
    isFetching,
    add,
    update,
    remove,
    promote,
    startEdit,
    cancelEdit,
    saveEdit,
  };
};
