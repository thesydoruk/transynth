/**
 * knownStrings.ts
 *
 * Per-game lookup tables of translatable subrecords.
 * Key = 4-char record signature, Value = Set of translatable subrecord signatures.
 *
 * For localized plugins (TES4 flags & 0x80), these subrecords contain a uint32
 * LString ID resolved via .STRINGS/.DLSTRINGS/.ILSTRINGS files.
 * For non-localized plugins they contain null-terminated UTF-8 text directly.
 *
 * Games:
 *  - `fo4` — Fallout 4
 *  - `sse` — Skyrim Special Edition (and Skyrim LE — same record types)
 */

import type { GameType } from '../types.js';

/**
 * Fallout 4 translatable subrecords.
 * Contains FO4-specific records (TERM, INNR, SCEN, AMMO\\ONAM, etc.) that do not
 * exist or behave differently in Skyrim.
 */
export const FO4_TRANSLATABLE_SUBRECORDS: Record<string, Set<string>> = {
  ACTI: new Set(['FULL', 'RNAM', 'ATTX']),
  ALCH: new Set(['FULL', 'DESC', 'DNAM']),
  AMMO: new Set(['FULL', 'DESC', 'ONAM']),
  ARMO: new Set(['FULL', 'DESC']),
  ARMA: new Set(['DNAM']),
  BOOK: new Set(['FULL', 'DESC', 'CNAM']),
  CLAS: new Set(['FULL', 'DESC']),
  COBJ: new Set(['DESC']),
  CONT: new Set(['FULL']),
  DOOR: new Set(['FULL', 'ONAM', 'FNAM']),
  ENCH: new Set(['FULL']),
  EXPL: new Set(['FULL']),
  EYES: new Set(['FULL']),
  FACT: new Set(['FULL']),
  FLOR: new Set(['FULL', 'RNAM']),
  FURN: new Set(['FULL', 'RNAM', 'ATTX']),
  GRAS: new Set(['FULL']),
  GRUP: new Set(), // not a record
  HDPT: new Set(['FULL']),
  INFO: new Set(['NAM1', 'RNAM']),
  INGR: new Set(['FULL']),
  /**
   * Instance Naming Rules — each INNR FormID has a single FULL subrecord
   * containing one component of a compound item name (material, type, quality, etc.).
   * Multiple INNR records share an EDID prefix and are grouped for display.
   */
  INNR: new Set(['FULL']),
  KEYM: new Set(['FULL']),
  LVLI: new Set(['ONAM']),
  LCTN: new Set(['FULL']),
  LIGH: new Set(['FULL']),
  MESG: new Set(['FULL', 'DESC', 'ITXT']),
  MGEF: new Set(['FULL', 'DESC', 'DNAM']),
  MISC: new Set(['FULL']),
  NOTE: new Set(['FULL', 'DESC']),
  NPC_: new Set(['FULL', 'SHRT']),
  PERK: new Set(['FULL', 'DESC', 'EPF2']),
  PROJ: new Set(['FULL']),
  QUST: new Set(['FULL', 'NNAM']),
  RACE: new Set(['FULL', 'DESC']),
  SCEN: new Set(['NNAM']),
  SLGM: new Set(['FULL']),
  SPEL: new Set(['FULL', 'DESC']),
  STAT: new Set(['FULL']),
  CELL: new Set(['FULL']),
  REFR: new Set(['FULL']),
  TERM: new Set(['FULL', 'DESC', 'ITXT']),
  WEAP: new Set(['FULL', 'DESC', 'ONAM', 'BNAM']),
  WRLD: new Set(['FULL']),
};

/**
 * Skyrim SE / LE translatable subrecords.
 * Based on Skyrim record definitions; excludes FO4-only types (TERM, INNR, SCEN, AMMO\\ONAM, etc.)
 * and adds Skyrim-specific ones (SHOU, WORD, MUST, etc.).
 */
export const SSE_TRANSLATABLE_SUBRECORDS: Record<string, Set<string>> = {
  ACTI: new Set(['FULL', 'RNAM']),           // Activator — no ATTX in Skyrim
  ALCH: new Set(['FULL', 'DESC']),           // Potion — no DNAM
  AMMO: new Set(['FULL', 'DESC']),           // Ammo — no ONAM in SSE
  ARMO: new Set(['FULL', 'DESC']),
  BOOK: new Set(['FULL', 'DESC', 'CNAM']),
  CLAS: new Set(['FULL', 'DESC']),
  CELL: new Set(['FULL']),
  CLMT: new Set(['FULL']),
  COBJ: new Set(['DESC']),
  CONT: new Set(['FULL']),
  DIAL: new Set(['FULL']),
  DOOR: new Set(['FULL', 'ONAM', 'FNAM']),
  ENCH: new Set(['FULL']),
  EXPL: new Set(['FULL']),
  EYES: new Set(['FULL']),
  FACT: new Set(['FULL']),
  FLOR: new Set(['FULL', 'RNAM']),
  FURN: new Set(['FULL', 'RNAM']),
  GRAS: new Set(['FULL']),
  GRUP: new Set(),
  HDPT: new Set(['FULL']),
  INFO: new Set(['NAM1', 'RNAM']),
  INGR: new Set(['FULL']),
  KEYM: new Set(['FULL']),
  LIGH: new Set(['FULL']),
  LCTN: new Set(['FULL']),
  MESG: new Set(['FULL', 'DESC', 'ITXT']),
  MGEF: new Set(['FULL', 'DESC']),
  MISC: new Set(['FULL']),
  MUST: new Set(['FULL']),
  NPC_: new Set(['FULL', 'SHRT']),
  PERK: new Set(['FULL', 'DESC', 'EPF2']),
  PROJ: new Set(['FULL']),
  QUST: new Set(['FULL', 'NNAM']),
  RACE: new Set(['FULL', 'DESC']),
  REFR: new Set(['FULL']),
  SHOU: new Set(['FULL', 'DESC']),
  SLGM: new Set(['FULL']),
  SPEL: new Set(['FULL', 'DESC']),
  STAT: new Set(['FULL']),
  WEAP: new Set(['FULL', 'DESC']),
  WORD: new Set(['FULL', 'TNAM']),
  WRLD: new Set(['FULL']),
};

/**
 * Backward-compatible alias — points to the FO4 table.
 * @deprecated Use `getTranslatableSubrecords(game)` instead.
 */
export const TRANSLATABLE_SUBRECORDS = FO4_TRANSLATABLE_SUBRECORDS;

/**
 * Return the correct translatable-subrecords map for the given game.
 *
 * @param game - `'fo4'` (default), `'sse'`, or `'sle'`.
 */
export const getTranslatableSubrecords = (game: GameType): Record<string, Set<string>> =>
  game === 'sse' || game === 'sle' ? SSE_TRANSLATABLE_SUBRECORDS : FO4_TRANSLATABLE_SUBRECORDS;

/**
 * Returns true if this subrecord/record combination is translatable for the given game.
 *
 * @param recSig - 4-char record signature, e.g. "ARMO".
 * @param subSig - 4-char subrecord signature, e.g. "FULL".
 * @param game   - Target game; defaults to 'fo4' for backward compatibility.
 */
export const isTranslatableSubrecord = (
  recSig: string,
  subSig: string,
  game: GameType = 'fo4',
): boolean => getTranslatableSubrecords(game)[recSig]?.has(subSig) ?? false;
