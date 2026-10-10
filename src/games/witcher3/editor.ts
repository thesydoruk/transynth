import type { GameEditorCapabilities } from '../contract';

/**
 * A Witcher 3 row is one entry of a `.w3strings` table: a numeric id, the
 * table it sits in, and the text. There are no FormIDs and no record signature
 * worth a column. A spoken line's speaker and their gender come from the
 * game's scene files, so the grid shows them and there is nothing for LLM
 * gender detection to guess. The voice tab lists the takes of the imported
 * `.w3speech` containers by speaker.
 */
export const WITCHER3_EDITOR: GameEditorCapabilities = {
  modes: ['strings', 'voice'],
  columns: { formId: false, signature: false, gender: true },
  actions: { genderDetect: false, innrLink: false },
  labels: { signature: 'w3Table', edid: 'w3Key', field: 'w3Id' },
  recordPathStyle: 'record-path',
};
