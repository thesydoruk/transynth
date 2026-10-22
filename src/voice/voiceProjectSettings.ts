import type { Tx } from '../db';
import {
  clampTtsRetries,
  clampTtsRetryBelow,
  type TtsSynthesisParams,
} from '../tts/ttsSynthesisParams';
import { syncServiceRegistryFromProjectSettings } from '../services/registry';
import {
  getAllProjectSettings,
  SETTING_DEFAULTS,
  type ProjectSettings,
} from '../web/services/projectSettings';
import { gameTtsMatchFor } from './gameTtsSettings';
import type { TtsReferenceMode } from './voiceToolPaths';

/** Map persisted project settings to TTS reference clip mode. */
export const voiceReferenceModeFromProjectSettings = (
  settings: ProjectSettings,
): TtsReferenceMode => (settings['voice.line_reference'] ? 'line' : 'speaker');

/** Map persisted project settings to synthesis params: per-game match flags plus the retry policy. */
export const voiceSynthesisFromProjectSettings = (
  settings: ProjectSettings,
  game?: string | null,
): TtsSynthesisParams => {
  const match = gameTtsMatchFor(settings['voice.game_tts'], game);
  return {
    matchLoudness: true,
    matchTiming: match.matchTiming,
    retryBelow: settings['voice.synth_retry_below'],
    retries: settings['voice.synth_retries'],
  };
};

/**
 * The retry policy as it is in the database right now.
 *
 * A voice job loads its settings once at start, but the threshold and the retry budget
 * are tuned while a job runs, by watching takes come in. Every line therefore re-reads
 * these two keys just before synthesis, so a change on the settings page applies to
 * the next line without restarting the job. The match flags stay per job.
 */
export const withLiveRetryPolicy = async (
  db: Tx,
  synthesis: TtsSynthesisParams,
): Promise<TtsSynthesisParams> => {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM project_settings
      WHERE key IN ('voice.synth_retry_below', 'voice.synth_retries')`,
  );
  let retryBelow = SETTING_DEFAULTS['voice.synth_retry_below'];
  let retries = SETTING_DEFAULTS['voice.synth_retries'];
  for (const row of rows) {
    if (row.key === 'voice.synth_retry_below') retryBelow = Number(row.value);
    if (row.key === 'voice.synth_retries') retries = Number(row.value);
  }
  return {
    ...synthesis,
    retryBelow: clampTtsRetryBelow(retryBelow),
    retries: clampTtsRetries(retries),
  };
};

/**
 * Push the service endpoints from project settings into the registry (and so into the
 * TTS, audio-intel and tools pools). The name is historical: it used to set only the
 * Fish Speech limit, which is still what `voice.tts_max_parallel_fish_speech` does for
 * the env-configured TTS host.
 */
export const syncTtsPoolFromProjectSettings = (settings: ProjectSettings): void => {
  syncServiceRegistryFromProjectSettings(settings);
};

/** Fish Speech concurrency limit from project settings. */
export const voiceTtsMaxParallelFromProjectSettings = (settings: ProjectSettings): number =>
  settings['voice.tts_max_parallel_fish_speech'];

/** Load voice synthesis settings from project_settings (match flags for `game`). */
export const loadVoiceProjectSettings = async (
  db: Tx,
  game?: string | null,
): Promise<{
  referenceMode: TtsReferenceMode;
  synthesis: TtsSynthesisParams;
  ttsMaxParallel: number;
}> => {
  const settings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(settings);
  return {
    referenceMode: voiceReferenceModeFromProjectSettings(settings),
    synthesis: voiceSynthesisFromProjectSettings(settings, game),
    ttsMaxParallel: settings['voice.tts_max_parallel_fish_speech'],
  };
};
