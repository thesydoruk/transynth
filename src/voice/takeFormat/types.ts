/**
 * How a title stores one voiced response on disk.
 *
 * Every Creation Engine title keeps its takes in the same tree,
 * `Sound/Voice/<plugin>/<voice type>/`, and identifies a line the same way —
 * owning plugin, lower-6 of the INFO FormID, a variant. What differs is the
 * file: its name, its container, what sits beside it, and how a new one is
 * made from TTS audio. A title declares one {@link VoiceTakeSpec}; the shared
 * voice pipeline is handed the matching {@link VoiceTakeFormat} and asks it,
 * so no shared module needs to know which game it is working on.
 */
import type { EspRecordLayout } from '../../formats/esp/recordLayout';
import type { WemCodecId } from '../../formats/wem';
import type { GameId } from '../../types';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import type { FaceFxActorSex } from '../faceFx/generateFfxanim';

/**
 * - `fuz` — `<FormID>_<response>.fuz`: xWMA audio and the `.lip` track in one
 *   file (Fallout 4, Skyrim, and the default).
 * - `wem-ffxanim` — `<WEM id>.wem`: Wwise audio, with the lip animation in a
 *   sibling `<WEM id>.ffxanim` (Starfield).
 */
export type VoiceTakeKind = 'fuz' | 'wem-ffxanim';

/**
 * What a title declares about its takes (`CreationEngineTitle.voice.takes`).
 * A `.wem` title also names the Wwise codec its new takes are encoded with —
 * the engine opens voice files expecting one codec, so it is the title's fact,
 * not something to infer. Source takes are decoded by what each file says it is.
 */
export type VoiceTakeSpec = { kind: 'fuz' } | { kind: 'wem-ffxanim'; codec: WemCodecId };

/** A file that travels with a take: same folder, same stem, its own extension. */
export type VoiceTakeSidecar = {
  /** With its dot, e.g. `.ffxanim`. */
  extension: string;
  data: Buffer;
};

/** A take ready to be written: the audio file and whatever must sit beside it. */
export type BuiltVoiceTake = {
  data: Buffer;
  sidecars: VoiceTakeSidecar[];
  /** The WAV the take was encoded from, for the browser. Only when asked for. */
  previewWav?: Buffer;
};

export type BuildVoiceTakeInput = {
  game: GameId;
  /** WAV bytes as the TTS server returned them. */
  ttsWav: Buffer;
  /** Scratch directory the caller owns and removes. */
  workDir: string;
  /** File name of the source take; its stem names the scratch files. */
  fileName: string;
  /** The spoken text, for lip-sync. */
  text: string;
  /** The original take, when the new one should mirror its container fields. */
  sourceTakePath?: string;
  /** Sex of the speaker's voice type, for formats whose lip-sync needs a face rig. */
  actor?: FaceFxActorSex;
  includePreviewWav?: boolean;
};

export type VoiceTakeFormat = {
  readonly kind: VoiceTakeKind;
  /** Extension of a localized take, with its dot. */
  readonly extension: string;
  /** File kind of a built take, as the regeneration preview names it. */
  readonly artifact: 'fuz' | 'wem';
  /** Extensions of the files written beside a take; they are copied, exported and deleted with it. */
  readonly sidecarExtensions: readonly string[];
  /** True when {@link VoiceTakeFormat.build} wants `actor`; the caller then looks the speaker up. */
  readonly needsSpeakerSex: boolean;
  /**
   * How the title's FormIDs name their master plugin, when it is not the plain
   * top-byte index: which plugin owns a line, and the line's key, follow it.
   */
  readonly pluginFormIds?: EspRecordLayout['plugin'];

  /**
   * A plugin's source takes — its own and the ones it ships under a master's
   * folder — one per speaker folder and response.
   */
  discover(packageDir: string, pluginRelPath: string): VoiceFileEntry[];

  /** Where the localized take of a source take goes, relative to the localize directory. */
  localizedRelPath(entry: VoiceFileEntry): string;

  /**
   * Maps a take's path (relative to a package or localize tree) to its voice key
   * `<origin>/FORMID6:variant`, or null when the file is not a take. A format
   * whose file names do not carry the line needs the plugin to resolve them,
   * and answers null for every path when it is given none.
   */
  voiceKeyResolver(pluginPath?: string | null): (relPath: string) => string | null;

  /**
   * The file name this plugin gives the take of `entry`'s line, when the name is
   * not derived from the line itself — a patch may give a master's response
   * another id. Null when the plugin names no file for it; absent for formats
   * that name takes after the line.
   */
  ownTakeFileName?(pluginPath: string, entry: VoiceFileEntry): string | null;

  /** Turn TTS audio into a take. */
  build(input: BuildVoiceTakeInput): Promise<BuiltVoiceTake>;
};
