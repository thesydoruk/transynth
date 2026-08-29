import { useState } from 'react';

export type VoiceLineFilter = 'all' | 'needsTranslation' | 'needsVoice';

/** Local UI state for the voice editor: speaker pick, search, and line filters. */
export const useVoiceState = () => {
  const [search, setSearch] = useState('');
  const [speakerKey, setSpeakerKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<VoiceLineFilter>('all');
  const [find, setFind] = useState('');

  return {
    search,
    setSearch,
    speakerKey,
    setSpeakerKey,
    filter,
    setFilter,
    find,
    setFind,
  };
};
