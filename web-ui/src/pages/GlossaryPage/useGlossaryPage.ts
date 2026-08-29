import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentGame, getSrcLang, getTgtLang, modListQueryKey } from '../../langDefaults';
import { api, type GlossaryEntry } from '../../api';

export const useGlossaryPage = () => {
  const qc = useQueryClient();
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [tgtLang, setTgtLang] = useState(getTgtLang());
  const [q, setQ] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editTerm, setEditTerm] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [enforceModId, setEnforceModId] = useState<number | ''>('');
  const newTermRef = useRef<HTMLInputElement | null>(null);

  const currentGameId = getCurrentGame() ?? undefined;
  const { data: mods } = useQuery({
    queryKey: modListQueryKey(currentGameId),
    queryFn: () => api.mods.list(currentGameId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['glossary', srcLang, tgtLang, q],
    queryFn: () =>
      api.glossary.list({
        srcLang: srcLang || undefined,
        tgtLang: tgtLang || undefined,
        q: q || undefined,
      }),
  });

  const enforce = useMutation({
    mutationFn: () =>
      api.glossary.enforce({
        modId: enforceModId !== '' ? enforceModId : undefined,
        targetLang: tgtLang || getTgtLang(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qa'] });
    },
  });

  const add = useMutation({
    mutationFn: () =>
      api.glossary.add(newTerm.trim(), newTranslation.trim() || null, srcLang, tgtLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['glossary'] });
      setNewTerm('');
      setNewTranslation('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.glossary.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      term,
      translation,
    }: {
      id: number;
      term: string;
      translation: string | null;
    }) => api.glossary.update(id, term, translation),
    onSuccess: () => {
      setEditId(null);
      setEditTerm('');
      setEditTranslation('');
      qc.invalidateQueries({ queryKey: ['glossary'] });
    },
  });

  const startEdit = (entry: GlossaryEntry) => {
    setEditId(entry.id);
    setEditTerm(entry.term);
    setEditTranslation(entry.translation ?? '');
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditTerm('');
    setEditTranslation('');
  };

  const saveEdit = () => {
    if (!editId || !editTerm.trim()) return;
    update.mutate({
      id: editId,
      term: editTerm.trim(),
      translation: editTranslation.trim() || null,
    });
  };

  return {
    srcLang,
    setSrcLang,
    tgtLang,
    setTgtLang,
    q,
    setQ,
    newTerm,
    setNewTerm,
    newTranslation,
    setNewTranslation,
    editId,
    editTerm,
    setEditTerm,
    editTranslation,
    setEditTranslation,
    enforceModId,
    setEnforceModId,
    newTermRef,
    mods,
    data,
    isLoading,
    enforce,
    add,
    remove,
    update,
    startEdit,
    cancelEdit,
    saveEdit,
  };
};
