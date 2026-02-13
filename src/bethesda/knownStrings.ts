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
 *  - `fo4`  — Fallout 4
 *  - `fo76` — Fallout 76 (shares FO4 table)
 *  - `fo3`  — Fallout 3
 *  - `fnv`  — Fallout: New Vegas (extends FO3 table with NV-specific records)
 *  - `sse`  — Skyrim Special Edition (and Skyrim LE — same record types)
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
 * Fallout 3 translatable subrecords.
 *
 * FO3 uses the Gamebryo engine (pre-Creation Engine). Most FO3 mods are
 * non-localized — strings are embedded inline in ESP records rather than
 * externalized to .STRINGS/.DLSTRINGS/.ILSTRINGS files.
 *
 * Key differences from FO4:
 *  - No INNR, SCEN, COBJ, ARMA, OMOD, LCTN, SLGM (FO4/SSE-specific).
 *  - No ATTX subrecord on ACTI/FURN.
 *  - FACT has MNAM/FNAM (male/female rank names).
 *  - NOTE has TNAM (text content of notes).
 *  - TERM has BTXT/RNAM (button and result text).
 *  - MGEF uses DESC (not DNAM like FO4).
 *  - DIAL records with FULL (dialog topic names).
 */
export const FO3_TRANSLATABLE_SUBRECORDS: Record<string, Set<string>> = {
  ACTI: new Set(['FULL']),
  ALCH: new Set(['FULL']),
  AMMO: new Set(['FULL']),
  ARMO: new Set(['FULL', 'DESC']),
  BOOK: new Set(['FULL', 'DESC']),
  CELL: new Set(['FULL']),
  CLAS: new Set(['FULL', 'DESC']),
  CONT: new Set(['FULL']),
  DIAL: new Set(['FULL']),
  DOOR: new Set(['FULL']),
  ENCH: new Set(['FULL']),
  EXPL: new Set(['FULL']),
  EYES: new Set(['FULL']),
  FACT: new Set(['FULL', 'MNAM', 'FNAM']),
  FLOR: new Set(['FULL']),
  FURN: new Set(['FULL']),
  HDPT: new Set(['FULL']),
  INFO: new Set(['NAM1']),
  INGR: new Set(['FULL']),
  KEYM: new Set(['FULL']),
  LIGH: new Set(['FULL']),
  MESG: new Set(['FULL', 'DESC', 'ITXT']),
  MGEF: new Set(['FULL', 'DESC']),
  MISC: new Set(['FULL']),
  NOTE: new Set(['FULL', 'TNAM']),
  NPC_: new Set(['FULL', 'SHRT']),
  PERK: new Set(['FULL', 'DESC']),
  PROJ: new Set(['FULL']),
  QUST: new Set(['FULL', 'NNAM']),
  RACE: new Set(['FULL', 'DESC']),
  SPEL: new Set(['FULL']),
  TERM: new Set(['FULL', 'DESC', 'ITXT', 'RNAM', 'BTXT']),
  WEAP: new Set(['FULL', 'DESC']),
  WRLD: new Set(['FULL']),
};

/**
 * Fallout: New Vegas translatable subrecords.
 *
 * FNV extends the FO3 engine with several New Vegas-specific record types:
 *  - CHAL (Challenge) — quest-like challenges with FULL + DESC.
 *  - CCRD (Caravan Card) — Caravan mini-game cards.
 *  - CMNY (Caravan Money) — Caravan currency items.
 *  - CSNO (Casino) — casino definitions with display names.
 *  - IMOD (Item Mod) — weapon/armor modification items with FULL + DESC.
 *  - RCPE (Recipe) — crafting recipes with display names.
 *  - REPU (Reputation) — faction reputation entries.
 *
 * All other records share the FO3 table.
 */
export const FNV_TRANSLATABLE_SUBRECORDS: Record<string, Set<string>> = {
  ...FO3_TRANSLATABLE_SUBRECORDS,
  CHAL: new Set(['FULL', 'DESC']),
  CCRD: new Set(['FULL']),
  CMNY: new Set(['FULL']),
  CSNO: new Set(['FULL']),
  IMOD: new Set(['FULL', 'DESC']),
  RCPE: new Set(['FULL']),
  REPU: new Set(['FULL']),
};

/**
 * Backward-compatible alias — points to the FO4 table.
 * @deprecated Use `getTranslatableSubrecords(game)` instead.
 */
export const TRANSLATABLE_SUBRECORDS = FO4_TRANSLATABLE_SUBRECORDS;

/**
 * Return the correct translatable-subrecords map for the given game.
 *
 * - `fo4` / `fo76` → FO4 table (FO76 uses the same Creation Engine records).
 * - `fo3`          → FO3 table.
 * - `fnv`          → FNV table (extends FO3 with New Vegas-specific records).
 * - `sse` / `sle`  → SSE table.
 *
 * @param game - Target game identifier.
 */
export const getTranslatableSubrecords = (game: GameType): Record<string, Set<string>> => {
  switch (game) {
    case 'sse':
    case 'sle':
      return SSE_TRANSLATABLE_SUBRECORDS;
    case 'fo3':
      return FO3_TRANSLATABLE_SUBRECORDS;
    case 'fnv':
      return FNV_TRANSLATABLE_SUBRECORDS;
    default:
      return FO4_TRANSLATABLE_SUBRECORDS;
  }
};

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
