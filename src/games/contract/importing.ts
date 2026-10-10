import type { Tx } from '../../db';
import type { GameId } from '../../types';
import type { ModImportJob, ProgressCb } from '../../import/mod/types';

/**
 * What a game's import adapter can tell about an upload before ingesting it.
 *
 * Both numbers seed the job row: `totalRecords` is the progress-bar total and
 * `isLocalized` records whether the text lives in external string tables (so
 * the export side knows to write tables rather than patch the anchor).
 */
export type AnchorDescription = {
  isLocalized: boolean;
  /** Estimated translatable record count. The ingestion refines it if it can. */
  totalRecords: number;
};

/** Cancel / pause flags flipped by the job control channel while an import runs. */
export type ImportRunState = { cancel: boolean; pause: boolean };

/**
 * Mutable state threaded through one import run.
 *
 * Counters are boxed (`{ value }`) so a phase can advance them and the caller
 * still sees the update after an early return on cancel or pause.
 *
 * Only fields every game needs live here. Anything one engine family needs on
 * top of this (Creation Engine's STRINGS locale sources, its ESP reader) is
 * built by that plugin and passed between its own phases.
 */
export type ModImportRunContext = {
  db: Tx;
  job: ModImportJob;
  state: ImportRunState;
  /** Absolute path of the anchor file — see {@link ImportAnchor}. */
  anchorPath: string;
  game: GameId;
  importModId: number | null;
  imported: { value: number };
  progressTotal: { value: number };
  /**
   * Locale tag the anchor's own text is stored under, e.g. `en`. Games that
   * ship one file per language use it to label the source rows.
   */
  pluginStringLang: string;
  /** True when the operator asked for a single locale instead of all of them. */
  importSingleLocaleMode: { value: boolean };
  /** The chosen locale in single-locale mode, else null. */
  selectedLocale: { value: string | null };
  /** First run of a job prunes rows left over from a previous import of the mod. */
  pruneStaleImportData: boolean;
  keptImportRecordKeys: Set<string>;
  keptImportStringIds: Set<number>;
  onProgress?: ProgressCb;
  startTime: number;
};

/** One mod to re-derive dialog speakers for. */
export type DialogSpeakerRefreshContext = {
  db: Tx;
  modId: number;
  /** The mod's stored anchor file, as `mods.abs_path` records it. */
  modPath: string;
  /** Locale the mod's own strings were imported under. */
  srcLang: string;
  /** Report what would change without writing anything. */
  dryRun: boolean;
};

/** What a refresh found, for the caller to log. */
export type DialogSpeakerRefresh = {
  /** Actor records the plugin and its masters yielded. */
  actors: number;
  speakers: number;
  /** Speakers the refresh could put a gender on. */
  withGender: number;
  /** Nodes whose speaker came from a scene alias rather than the record itself. */
  recoveredSpeakers: number;
};

/** What the operator asked for when importing a folder on disk. */
export type FolderImportOptions = {
  /** Treat each subfolder as its own mod instead of the whole folder as one. */
  perMod: boolean;
  /** Read only these languages, in the game's own codes. Null reads all. */
  langs: ReadonlySet<string> | null;
  /** Name for a single-mod import; the plugin picks one when unset. */
  name?: string;
};

/** One mod a folder import will register, and the files it needs. */
export type FolderImportUnit = {
  name: string;
  /** The folder it was read from, recorded on the job as its source. */
  sourceFolder: string;
  /**
   * Files to put into mod storage. `relPath` (forward slashes) is where each
   * lands in the staged tree, which is then imported exactly like an extracted
   * upload — so it must be the layout {@link GameImportAdapter.selectAnchor}
   * and the export expect.
   */
  files: FolderImportFile[];
};

/**
 * One staged file: a copy of `absPath`, or bytes the plugin produces with
 * `read` — a file it takes out of a game archive, so the archive itself (most
 * of it meshes and textures) never has to be copied.
 */
export type FolderImportFile =
  | { relPath: string; absPath: string }
  | { relPath: string; read: () => Buffer; size: number };

/**
 * How one game gets text out of an uploaded mod and into the database.
 *
 * The shared runner owns the write lock, the job row, progress reporting, and
 * failure handling. Everything format-specific — which file anchors the
 * import, how many records to expect, and the ingestion itself — is here.
 */
export type GameImportAdapter = {
  /**
   * File extensions accepted as a direct (non-archive) upload, lowercase and
   * dot-prefixed, e.g. `['.esp', '.esm', '.esl']`. Archives (`.zip`, `.7z`,
   * `.rar`) are always accepted and unpacked before {@link selectAnchor} runs.
   */
  readonly uploadExtensions: readonly string[];

  /**
   * Pick the file inside an extracted upload that the import is anchored to —
   * the path stored as `mod_imports.esp_path`, which everything else in the
   * upload is discovered relative to. Null when the archive holds nothing this
   * game can import.
   */
  selectAnchor(extractDir: string): string | null;

  /**
   * Inspect a chosen anchor without ingesting it. `extractRoot` is the root of
   * the extracted upload, which may be the anchor's own directory for a bare
   * plugin upload.
   */
  describeAnchor(anchorPath: string, extractRoot: string): AnchorDescription;

  /**
   * Read the mod and write its records, strings, translations, speakers, and
   * voice index. Must honour `ctx.state.cancel` / `ctx.state.pause` between
   * batches and finish by calling the shared `finalizeModImport`.
   */
  ingest(ctx: ModImportRunContext): Promise<void>;

  /**
   * Plan an import from a folder on disk (`npm run import:folder`): which mods
   * the folder holds and which of its files each one needs.
   *
   * The files are copied into mod storage before anything is read, never
   * imported in place — deleting a mod deletes its stored tree, and that must
   * not be someone's game install. Absent when a game is only ever uploaded.
   */
  planFolderImport?(dir: string, options: FolderImportOptions): FolderImportUnit[];

  /**
   * Re-derive who speaks and who is addressed for a mod already imported.
   *
   * Speakers are worked out during {@link ingest}, so a fix to how they are
   * derived would otherwise reach only new imports; this re-runs that one step
   * against the files on disk and touches nothing else — strings, translations
   * and review status stay as they are.
   *
   * Absent when the game has no dialog graph to re-read.
   */
  refreshDialogSpeakers?(ctx: DialogSpeakerRefreshContext): Promise<DialogSpeakerRefresh>;
};
