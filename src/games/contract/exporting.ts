import type { Tx } from '../../db';
import type { ZipPackEntry } from '../../web/export/exportTypes';

/** One mod, one language pair — the inputs every export path needs. */
export type ModExportContext = {
  db: Tx;
  modId: number;
  /** Absolute path of the import anchor stored in `mods.abs_path`. */
  modPath: string;
  srcLang: string;
  targetLang: string;
};

/** A finished ZIP, ready to stream to the browser or write to disk. */
export type ExportedZip = { zipBuffer: Buffer; zipFileName: string };

/**
 * How one game turns reviewed translations back into files players install.
 *
 * The two shapes every game supports:
 * - **langpack** — only the localized files, for players who own the mod;
 * - **full mod** — the whole mod with translations applied.
 *
 * A game whose distribution shape is the same for both (Disco Elysium ships
 * language folders either way) points both at the same implementation.
 */
export type GameExportAdapter = {
  /**
   * Loose localized files for this mod, before they are zipped. An empty
   * result means there is nothing translated yet — the caller reports
   * {@link emptyLangpackMessage}.
   */
  collectLangpackEntries(ctx: ModExportContext): Promise<ZipPackEntry[]>;

  /** Shown to the operator when {@link collectLangpackEntries} finds nothing. */
  readonly emptyLangpackMessage: string;

  /** Prefix used in export log lines, e.g. `Disco langpack`. */
  readonly logLabel: string;

  /**
   * Post-process the collected entries just before zipping — a hook for games
   * that must repack some of their own output (Fallout 4 wraps synthesized
   * voice in an uncompressed BA2 so the engine will play it).
   *
   * `stagingDir` is a scratch directory that the caller deletes afterwards.
   * Return the entries to pack, in order.
   */
  finalizeLangpackEntries?(
    entries: ZipPackEntry[],
    stagingDir: string,
  ): ZipPackEntry[] | Promise<ZipPackEntry[]>;

  /** Build the full-mod ZIP: every mod asset, with translations applied. */
  exportFullModZip(ctx: ModExportContext): Promise<ExportedZip>;
};
