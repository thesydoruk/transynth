import type { GameId } from '../../types';
import type { GameCatalogueEntry } from '../contract';
import type { GameDeploymentAdapter } from '../contract';
import type { GameMediaAdapter } from '../contract';
import type { GamePromptAdapter } from '../contract';
import type { TranslatableSubrecords } from '../../formats/subrecords';
import type { CompiledRecorddefs } from '../../formats/strings/recorddefs';
import type { EspRecordLayout } from '../../formats/esp';
import type { VoiceTakeSpec } from '../../voice/takeFormat';

/**
 * One Creation Engine title.
 *
 * Every Bethesda game Transynth supports runs the same pipeline — read an
 * ESP/ESM, pull STRINGS tables out of a BA2/BSA, patch, repack — and differs
 * in the values below. `createCreationEnginePlugin` turns one of these into a
 * full {@link GamePlugin}, so a title that only changes those values (Skyrim
 * VR) is a new file in `titles/` and one line in `src/games/index.ts`. A title
 * that changes the formats themselves needs more: Starfield also brought its
 * own subrecord and STRINGS-table data, prompts and glossary, a BA2 version,
 * and record layouts of its own.
 *
 * A game that is *not* Creation Engine does not belong here: it writes its own
 * plugin against the contract instead.
 */
export type CreationEngineTitle = {
  id: GameId;
  catalogue: GameCatalogueEntry;

  /** Which subrecords of which records hold translatable text. */
  subrecords: TranslatableSubrecords;

  /** Which STRINGS table (STRINGS / DLSTRINGS / ILSTRINGS) a record field belongs in. */
  recorddefs: CompiledRecorddefs;

  /**
   * Where speakers, voice types, dialogue order and scene actions sit in this
   * title's records, and how its FormIDs name masters. Omitted, the plugin
   * reads as Fallout 4 (`DEFAULT_ESP_RECORD_LAYOUT`).
   */
  records?: EspRecordLayout;

  /** Vanilla NPC FormID → display name, for speakers the mod does not redeclare. */
  npcReference: () => Map<string, string>;

  /** Legacy engine keywords that must survive translation verbatim. */
  functionKeywords: readonly string[];

  /** One-word tone prompts on the dialogue wheel; see `GameTextAdapter.toneTagPrompts`. */
  toneTagPrompts?: readonly string[];

  archive: {
    /** Container the game packs assets into. */
    kind: 'ba2' | 'bsa';
    /** BSA header version to write. Ignored for `ba2` titles. */
    bsaVersion: number;
    /**
     * BA2 header version to write: 1 for Fallout 4 / 76 (the default when
     * omitted), 2 for Starfield's GNRL archives. Ignored for `bsa` titles.
     */
    ba2Version?: number;
  };

  strings: {
    /**
     * Where localized STRINGS tables are looked for, in order. The first
     * container that yields tables wins; `loose` is always the last resort.
     */
    lookupOrder: readonly ('bsa' | 'ba2' | 'loose')[];
    /**
     * Locale suffixes the game itself ships. A target outside this set is
     * "unofficial" and is written into the {@link unofficialSlots} instead.
     * `null` means the game accepts any locale suffix and no slot juggling is
     * needed.
     */
    officialLocales: ReadonlySet<string> | null;
    /**
     * The official locales an unofficial target replaces — the ones players
     * switch between. Defaults to `en` and `ru`; a game without Russian lists
     * `en` alone.
     */
    unofficialSlots?: readonly string[];
    /**
     * Archives named `<plugin stem><suffix>.ba2` that hold the plugin's string
     * tables and are looked in before the Creation Kit's `- Main` /
     * `- Interface` (Starfield: `' - Localization'`). Unset: only those two.
     */
    archiveSuffixes?: readonly string[];
  };

  /**
   * Interface fonts, for titles whose fonts lack an unofficial language's letters
   * altogether. Omitted, export does what it does for Fallout 4: rebuild the
   * placeholder glyphs of `Interface/fonts_<slot>.swf` in place and adapt the
   * shared `FontConfig.txt`.
   */
  interfaceFonts?: {
    /** Font libraries of one locale slot inside `Interface/`; `{slot}` is its suffix. */
    libraries: readonly string[];
    /** The slot's font config inside `Interface/`; `{slot}` is its suffix. */
    config: string;
    /**
     * Libraries of the game that draw the missing letters in the same designs
     * (Starfield: the Japanese set carries Cyrillic). The letters are copied into
     * the slot's libraries and fitted to each font.
     */
    donorLibraries: readonly string[];
    /**
     * Family a logical font's family is replaced with when it still cannot draw the
     * language — a display face with no counterpart among the donors. Unlisted
     * families fall back to the closest usable one by name.
     */
    fallbackFamilies?: Readonly<Record<string, string>>;
  };

  /**
   * File-name prefixes of the official add-ons the game's store sells, which
   * are told from mods by name alone (Creation Club: `cc`). Defaults to `cc`.
   */
  addonPluginPrefixes?: readonly string[];

  voice: {
    /** Title name FaceFXWrapper expects when generating `.lip` files. */
    faceFxTitle: string;
    /**
     * Fallout 4 will not play loose synthesized voice, so its langpack wraps
     * the takes in an uncompressed `UASoundPack - Main.ba2` plus a dummy ESP.
     * Every other title ships the takes as loose files.
     */
    packLangpackVoiceIntoBa2: boolean;
    /**
     * How the title stores a voiced response: `{ kind: 'fuz' }`
     * (`<FormID>_<n>.fuz`, audio and lip track in one file — the default) or
     * `{ kind: 'wem-ffxanim', codec }` (Starfield: `<WEM id>.wem` with a
     * sibling `.ffxanim`; `codec` is the Wwise codec new takes are encoded
     * with). Everything about take files — discovery, naming, building,
     * export — follows from it.
     */
    takes?: VoiceTakeSpec;
  };

  /** Vortex deployment data. Every Creation Engine title has one. */
  deployment: GameDeploymentAdapter;

  /** Cutscene videos (Bink); only titles whose videos are dubbed set it. */
  media?: GameMediaAdapter;

  /** Prompts, rules, and glossary. */
  prompts: GamePromptAdapter;

  /** Titles that reuse another's stored glossary / QA rules. Defaults to itself. */
  storageKeys?: { glossary?: GameId; qaRules?: GameId };
};
