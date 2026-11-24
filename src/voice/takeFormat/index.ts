import type { EspRecordLayout } from '../../formats/esp/recordLayout';
import type { GameVoiceAdapter } from '../../games/contract';
import { gamePlugin } from '../../games/registry';
import { FUZ_TAKES } from './fuzTakes';
import type { VoiceTakeFormat, VoiceTakeSpec } from './types';
import { FFXANIM_EXTENSION, WEM_EXTENSION, wemFfxanimTakes } from './wemTakes';

export { FUZ_TAKES } from './fuzTakes';
export { wemFfxanimTakes } from './wemTakes';
export type {
  BuildVoiceTakeInput,
  BuiltVoiceTake,
  VoiceTakeFormat,
  VoiceTakeKind,
  VoiceTakeSidecar,
  VoiceTakeSpec,
} from './types';

/**
 * Extensions of every file any take format writes into a localize tree — the
 * takes and their sidecars — without the dot, for maintenance that sweeps them
 * all whatever the game.
 */
export const LOCALIZED_TAKE_EXTENSIONS = {
  takes: [FUZ_TAKES.extension, WEM_EXTENSION].map((extension) => extension.slice(1)),
  sidecars: [FFXANIM_EXTENSION].map((extension) => extension.slice(1)),
} as const;

/**
 * The format a title declared; `.fuz` when it declared none. `pluginFormIds` is
 * the title's rule for which master a FormID names, for the formats that look
 * lines up in the plugin.
 */
export const voiceTakeFormat = (
  spec?: VoiceTakeSpec | null,
  pluginFormIds?: EspRecordLayout['plugin'],
): VoiceTakeFormat =>
  spec?.kind === 'wem-ffxanim' ? wemFfxanimTakes(spec.codec, pluginFormIds) : FUZ_TAKES;

/**
 * The take format behind a voice adapter. Adapters of games that do not keep
 * takes in a `Sound/Voice` tree leave `takes` unset; code that only runs for
 * the ones that do gets the default.
 */
export const voiceTakesOf = (
  voice: Pick<GameVoiceAdapter, 'takes'> | null | undefined,
): VoiceTakeFormat => voice?.takes ?? FUZ_TAKES;

/** {@link voiceTakesOf} for a game id as stored on a mod. */
export const voiceTakesForGame = (game: string | null | undefined): VoiceTakeFormat =>
  voiceTakesOf(gamePlugin(game).voice);

/**
 * Maps the files of one mod's localize tree to voice keys: through the take
 * format when the game has one (it may need the mod's plugin to read a file
 * name), through the adapter's own path rule otherwise.
 */
export const voiceTakeKeyResolver = (
  voice: Pick<GameVoiceAdapter, 'voiceKeyFromRelPath' | 'takes'>,
  pluginPath?: string | null,
): ((relPath: string) => string | null) =>
  voice.takes
    ? voice.takes.voiceKeyResolver(pluginPath)
    : (relPath) => voice.voiceKeyFromRelPath(relPath);
