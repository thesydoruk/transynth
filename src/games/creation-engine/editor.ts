import type { GameEditorCapabilities } from '../contract';

/**
 * Editor profile shared by every Creation Engine title.
 *
 * Bethesda mods have all of it: a dialogue graph, voice takes, FormIDs,
 * record signatures, and speaker genders the LLM can be asked to detect.
 */
export const CREATION_ENGINE_EDITOR: GameEditorCapabilities = {
  modes: ['strings', 'dialogs', 'voice'],
  columns: { formId: true, signature: true, gender: true },
  actions: { genderDetect: true, innrLink: true },
  labels: { signature: 'grup', edid: 'edid', field: 'field' },
  recordPathStyle: 'record-path',
};
