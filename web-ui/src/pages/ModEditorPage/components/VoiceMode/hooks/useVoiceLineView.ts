import { useMemo } from 'react';
import type { VoiceLinePreview } from '../../../../../api';

/** Voice line with a dialogue record that can be translated in the editor. */
export const isEditableVoiceLine = (line: VoiceLinePreview): boolean =>
  line.stringId != null && !line.isOrphanAudio;

/** Cursor view over editable voice lines, keyed by `stringId`. */
export const useVoiceLineView = (lines: VoiceLinePreview[]) =>
  useMemo(() => {
    const editable = lines.filter(isEditableVoiceLine);
    const lineIds = editable.map((line) => line.stringId!);
    const lineById = new Map(editable.map((line) => [line.stringId!, line]));
    return { lineIds, lineById };
  }, [lines]);
