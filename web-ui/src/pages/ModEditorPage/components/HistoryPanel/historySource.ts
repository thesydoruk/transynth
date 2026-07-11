import type { TranslationHistoryEntry } from '../../api';

/** Known history revision source keys (stored in translation_revisions.note). */
export type HistorySourceKey =
  | 'llm'
  | 'tm'
  | 'tm_propagation'
  | 'save'
  | 'clear'
  | 'search_replace'
  | 'clear_same_as_source'
  | 'unknown';

const NOTE_ALIASES: Record<string, HistorySourceKey> = {
  llm: 'llm',
  tm: 'tm',
  tm_propagation: 'tm_propagation',
  save: 'save',
  clear: 'clear',
  deleted: 'clear',
  search_replace: 'search_replace',
  clear_same_as_source: 'clear_same_as_source',
};

/** Resolve a history entry to a stable source key for badge rendering. */
export const resolveHistorySource = (entry: TranslationHistoryEntry): HistorySourceKey => {
  if (entry.note) {
    const mapped = NOTE_ALIASES[entry.note];
    if (mapped) return mapped;
  }
  if (entry.status === 'deleted') return 'clear';
  if (entry.provenance === 'propagation') return 'tm_propagation';
  if (entry.provenance?.startsWith('tm_auto')) return 'tm';
  if (entry.provenance === 'auto_generated') return 'llm';
  if (entry.provenance === 'human_edit') return 'save';
  return 'unknown';
};

export const historySourceAccentColor = (source: HistorySourceKey): string => {
  switch (source) {
    case 'llm':
      return 'var(--info, #2196f3)';
    case 'tm':
    case 'tm_propagation':
      return 'var(--status-tm)';
    case 'save':
      return 'var(--status-human)';
    case 'clear':
      return 'var(--danger, #e55)';
    case 'search_replace':
      return 'var(--warning, #e8a735)';
    case 'clear_same_as_source':
      return 'var(--text-dim)';
    default:
      return 'var(--text-faint)';
  }
};
