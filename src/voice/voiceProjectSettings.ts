import type { Tx } from '../db';
import type { XttsSynthesisParams } from '../tts/xttsSynthesisParams';
import { getAllProjectSettings, type ProjectSettings } from '../web/services/projectSettings';
import type { TtsReferenceMode } from './voiceToolPaths';

/** Map persisted project settings to XTTS synthesis hyperparameters. */
export const voiceSynthesisFromProjectSettings = (
  settings: ProjectSettings,
): XttsSynthesisParams => ({
  temperature: settings['voice.temperature'],
  lengthPenalty: settings['voice.length_penalty'],
  repetitionPenalty: settings['voice.repetition_penalty'],
  topK: settings['voice.top_k'],
  topP: settings['voice.top_p'],
  speed: settings['voice.speed'],
  enableTextSplitting: settings['voice.enable_text_splitting'],
});

/** Map persisted project settings to XTTS reference clip mode. */
export const voiceReferenceModeFromProjectSettings = (
  settings: ProjectSettings,
): TtsReferenceMode => (settings['voice.line_reference'] ? 'line' : 'speaker');

/** Load voice synthesis and reference settings from project_settings. */
export const loadVoiceProjectSettings = async (
  db: Tx,
): Promise<{
  referenceMode: TtsReferenceMode;
  synthesis: XttsSynthesisParams;
}> => {
  const settings = await getAllProjectSettings(db);
  return {
    referenceMode: voiceReferenceModeFromProjectSettings(settings),
    synthesis: voiceSynthesisFromProjectSettings(settings),
  };
};
