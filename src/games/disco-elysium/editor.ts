import type { GameEditorCapabilities } from '../contract';

/**
 * Disco Elysium has no dialogue graph to browse and no FormIDs or record
 * signatures to show: a row is a gettext key in a `.po` file. Speaker gender
 * comes from the lockit metadata, so there is nothing for the LLM to detect.
 */
export const DISCO_EDITOR: GameEditorCapabilities = {
  modes: ['strings', 'voice'],
  columns: { formId: false, signature: true, gender: false },
  actions: { genderDetect: false, innrLink: false },
  labels: { signature: 'discoType', edid: 'discoAudio', field: 'discoKey' },
  recordPathStyle: 'po-key',
};
