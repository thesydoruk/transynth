import type { GameId } from '../../types';
import type { GameCatalogueEntry } from '../contract';
import type { GameDeploymentAdapter } from '../contract';
import type { GamePromptAdapter } from '../contract';
import type { TranslatableSubrecords } from '../../formats/subrecords';
import type { CompiledRecorddefs } from '../../formats/strings/recorddefs';

/**
 * One Creation Engine title.
 *
 * All eight Bethesda games Transynth supports run the same pipeline — read an
 * ESP/ESM, pull STRINGS tables out of a BA2/BSA, patch, repack — and differ
 * only in the values below. `createCreationEnginePlugin` turns one of these
 * into a full {@link GamePlugin}, so adding Starfield or Skyrim VR is a new
 * file in `titles/` and one line in `src/games/index.ts`.
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

  /** Vanilla NPC FormID → display name, for speakers the mod does not redeclare. */
  npcReference: () => Map<string, string>;

  /** Legacy engine keywords that must survive translation verbatim. */
  functionKeywords: readonly string[];

  archive: {
    /** Container the game packs assets into. */
    kind: 'ba2' | 'bsa';
    /** BSA header version to write. Ignored for `ba2` titles. */
    bsaVersion: number;
  };

  strings: {
    /**
     * Where localized STRINGS tables are looked for, in order. The first
     * container that yields tables wins; `loose` is always the last resort.
     */
    lookupOrder: readonly ('bsa' | 'ba2' | 'loose')[];
    /**
     * Locale suffixes the game itself ships. A target outside this set is
     * "unofficial" and is written into the `en` and `ru` slots so the patch
     * replaces the two locales players switch between. `null` means the game
     * accepts any locale suffix and no slot juggling is needed.
     */
    officialLocales: ReadonlySet<string> | null;
  };

  voice: {
    /** Title name FaceFXWrapper expects when generating `.lip` files. */
    faceFxTitle: string;
    /**
     * Fallout 4 will not play loose synthesized voice, so its langpack wraps
     * the takes in an uncompressed `UASoundPack - Main.ba2` plus a dummy ESP.
     * Every other title ships the takes as loose files.
     */
    packLangpackVoiceIntoBa2: boolean;
  };

  /** Vortex deployment data. Every Creation Engine title has one. */
  deployment: GameDeploymentAdapter;

  /** Prompts, rules, and glossary. */
  prompts: GamePromptAdapter;

  /** Titles that reuse another's stored glossary / QA rules. Defaults to itself. */
  storageKeys?: { glossary?: GameId; qaRules?: GameId };
};
