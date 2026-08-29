import type { VoiceLinePreview } from '../../../../api';
import type { VoiceLineFilter } from './hooks/useVoiceState';

/** Orphan audio has no dialogue record, so it is not translation work. */
export const needsTranslation = (line: VoiceLinePreview): boolean =>
  !line.isOrphanAudio && !line.translation?.trim();

/**
 * Restrict voice lines to the same string-status set as the translation grid.
 * `null` = no status filter; `undefined` = match ids still loading.
 */
export const applyVoiceStatusMatch = (
  lines: VoiceLinePreview[],
  allowedIds: Set<number> | null | undefined,
): VoiceLinePreview[] => {
  if (allowedIds === undefined) return [];
  if (allowedIds === null) return lines;
  return lines.filter((line) => line.stringId != null && allowedIds.has(line.stringId));
};

export const voiceLineCounts = (lines: VoiceLinePreview[]) => ({
  total: lines.length,
  needsTranslation: lines.filter(needsTranslation).length,
  needsVoice: lines.filter((line) => line.canGenerateVoice).length,
});

export const selectVisibleVoiceLines = (
  lines: VoiceLinePreview[],
  filter: VoiceLineFilter,
  find: string,
): VoiceLinePreview[] => {
  let filtered = lines;
  if (filter === 'needsTranslation') filtered = lines.filter(needsTranslation);
  else if (filter === 'needsVoice') filtered = lines.filter((line) => line.canGenerateVoice);
  const query = find.trim().toLowerCase();
  if (!query) return filtered;
  return filtered.filter(
    (line) =>
      (line.source ?? '').toLowerCase().includes(query) ||
      (line.translation ?? '').toLowerCase().includes(query),
  );
};
