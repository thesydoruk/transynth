/**
 * knownStrings.ts
 *
 * Lookup table of translatable subrecords per record type in Fallout 4.
 * Key = 4-char record signature, Value = Set of translatable subrecord signatures.
 *
 * For localized plugins (TES4 flags & 0x80), these subrecords contain a uint32
 * LString ID resolved via .STRINGS/.DLSTRINGS/.ILSTRINGS files.
 * For non-localized plugins they contain null-terminated UTF-8 text directly.
 */

export const TRANSLATABLE_SUBRECORDS: Record<string, Set<string>> = {
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

/** Returns true if this subrecord/record combination is translatable. */
export const isTranslatableSubrecord = (recSig: string, subSig: string): boolean => {
  return TRANSLATABLE_SUBRECORDS[recSig]?.has(subSig) ?? false;
}
