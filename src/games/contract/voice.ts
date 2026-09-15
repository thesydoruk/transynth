import type { Tx } from '../../db';
import type { GameId } from '../../types';
import type { VoiceTtsMarkupStyle } from '../../voice/prepareVoiceTtsText';
import type { VoiceFileEntry } from '../../voice/discoverVoiceFiles';
import type { TtsReferenceMode } from '../../voice/voiceToolPaths';
import type { TtsSynthesisParams } from '../../tts/ttsClient';
import type { VoiceLineCatalog, VoiceLineCatalogError } from '../../voice/lineCatalog';
import type { VoiceGenerateLineResult } from '../../web/voice/preview/types';

/** Which lines a mod-wide voice job touches. */
export type VoiceJobScope = 'all' | 'missing';

/** Everything a mod-wide voice job needs, already resolved from the job options. */
export type VoiceLocalizeRequest = {
  modId: number;
  /** The mod's game id, for the few tools that still need it (FaceFX, lip-sync). */
  game: GameId;
  /** Root of the mod's extracted upload. */
  extractDir: string;
  /** Absolute path of the import anchor, when the caller knows it. */
  pluginPath?: string;
  srcLang: string;
  tgtLang: string;
  ttsBaseUrl: string;
  synthesis: TtsSynthesisParams;
  referenceMode: TtsReferenceMode;
  scope: VoiceJobScope;
  force: boolean;
  dryRun: boolean;
  limit?: number;
  /** Restrict synthesis to these `FORMID6:variant` keys. */
  onlyKeys?: ReadonlySet<string>;
  /** Restrict synthesis to one speaker folder. */
  speakerKey?: string;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
  /** Called once per line eligible for synthesis, to drive the progress bar. */
  onEligibleStep?: () => void;
};

/** Where a mod-wide job records its results — appended to in place. */
export type VoiceLocalizeSink = {
  written: string[];
  skipped: string[];
  warnings: string[];
};

/** Which takes of a mod to list, and in which language pair. */
export type VoiceTakeQuery = {
  modId: number;
  /** Root of the mod's extracted upload. */
  extractDir: string;
  /** Absolute path of the import anchor, when the caller knows it. */
  pluginPath?: string;
  srcLang: string;
  targetLang: string;
  /** Restrict to one speaker. */
  speakerKey?: string;
};

/** One source take with the text that would be spoken over it. */
export type VoiceTake = {
  entry: VoiceFileEntry;
  speakerKey: string;
  /** Where the localized take goes, relative to the localize directory. */
  destRelPath: string;
  source: string;
  translation: string;
};

/** Inputs shared by the single-line synthesis entry points. */
export type VoiceLineRequest = {
  modId: number;
  /** Absolute path of the import anchor. */
  pluginPath: string;
  /** Package directory the anchor sits in. */
  packageDir: string;
  /** `_localize_{hash}/{lang}/` for this mod and target language. */
  localizeDir: string;
  lineKey: string;
  variant: number;
  srcLang: string;
  tgtLang: string;
  speakerKey?: string;
};

/** A preview take built in memory, before it is written into a review session. */
export type VoiceLinePreviewBuild =
  | { ok: false; reason: string; message: string }
  | {
      ok: true;
      /** Path of the localized take, relative to the localize directory. */
      destRelPath: string;
      payloadVersion: string;
      /** File kind of `audio`; anything but `wav` is converted for the browser. */
      artifact: 'wav' | 'fuz';
      audio: Buffer;
      speakerKey?: string;
      voiceSimilarity: number | null;
    };

/** Where an imported mod's files ended up, for locating its source audio. */
export type SourceTakeLocation = {
  /** Root the mod archive was extracted to. */
  extractDir: string;
  /** Absolute path of the mod's main plugin/data file, when it has one. */
  pluginPath: string;
};

/**
 * How one game stores, names, and synthesizes spoken lines.
 *
 * Games differ in every part of this: the file a take is stored as, the folder
 * layout that maps a take to a speaker, how source text is cleaned up before
 * TTS, and whether the engine wants a lip-sync file next to the audio. A game
 * with no voice support simply leaves `voice` unset on its plugin.
 */
export type GameVoiceAdapter = {
  /** Extension of a localized take on disk, e.g. `.fuz` or `.wav`. */
  readonly sourceExtension: string;

  /** TTS text-prep rules — how `*…*` and friends are treated before synthesis. */
  readonly markupStyle: VoiceTtsMarkupStyle;

  /**
   * Does this normalized (lowercase, forward-slash) package-relative path sit
   * inside the game's voice folder? Decides what a full-mod export overlays
   * with localized audio.
   */
  isLocalizedVoicePath(normalizedRelPath: string): boolean;

  /**
   * Map a localized clip's file name to its `FORMID6:variant` key, or null
   * when the file is not a voice take.
   */
  voiceKeyFromFileName(fileName: string): string | null;

  /** Where a localized take is written, relative to the localize directory. */
  localizedTakeRelPath(entry: VoiceFileEntry): string;

  /**
   * The mod's own source-language takes, as they sit on disk after import.
   *
   * Where they sit is entirely the game's business: a Creation Engine mod
   * keeps `.fuz` under `sound/voice/<plugin>/`, Disco ships loose `.wav`
   * under a per-language folder, and the next engine will do something else
   * again. Both halves of the extracted mod are handed over so an adapter can
   * use whichever it needs.
   */
  discoverSourceTakes(paths: SourceTakeLocation): VoiceFileEntry[];

  /**
   * Every source take in the mod, paired with the reviewed text of its line.
   *
   * Used by the reuse pass, which copies an existing synthesized take into a
   * new mod version when the spoken line and the source audio are unchanged.
   */
  listTakes(db: Tx, request: VoiceTakeQuery): Promise<VoiceTake[]>;

  /**
   * Keys whose localized clips may be packed into an export — the lines TTS
   * would actually synthesize, so leftovers and skipped vocalizations stay out.
   */
  loadExportableKeys(
    db: Tx,
    request: {
      modId: number;
      pluginPath: string;
      srcLang: string;
      targetLang: string;
      extractRoot?: string | null;
    },
  ): Promise<Set<string>>;

  /** How many lines a mod-wide job would synthesize, for the progress total. */
  countLocalizeWork(db: Tx, request: VoiceLocalizeRequest): Promise<number>;

  /** Run a mod-wide voice job, appending results to `sink`. */
  localize(db: Tx, request: VoiceLocalizeRequest, sink: VoiceLocalizeSink): Promise<void>;

  /** Synthesize one line and write it into the localize directory. */
  synthesizeLine(db: Tx, request: VoiceLineRequest): Promise<VoiceGenerateLineResult>;

  /** Synthesize one line in memory for the regeneration review flow. */
  buildLinePreview(
    db: Tx,
    request: Omit<VoiceLineRequest, 'localizeDir'> & { referenceMode: TtsReferenceMode },
  ): Promise<VoiceLinePreviewBuild>;

  /** Locate one source take on disk so the editor can play the original. */
  findLineEntry(
    db: Tx,
    request: {
      modId: number;
      pluginPath: string;
      lineKey: string;
      variant: number;
      speakerKey?: string;
    },
  ): Promise<VoiceFileEntry | null>;

  /**
   * Build the catalog behind the editor's voice tab: every take with its
   * source text, translation, speaker, and synthesis state.
   */
  loadLineCatalog(
    db: Tx,
    request: { modId: number; pluginPath: string; srcLang: string; targetLang: string },
  ): Promise<VoiceLineCatalog | VoiceLineCatalogError>;
};
