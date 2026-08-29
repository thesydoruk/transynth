/**
 * Parsing of stored record paths back into ESP subrecord references.
 *
 * Import writes paths as `SIG\FIELD` (e.g. `TERM\ITXT`), and `SIG\FIELD[n]` when
 * the reader already numbers repeated fields itself (INNR `WNAM[0]`, `WNAM[1]`).
 * Non-plugin sources reuse the same column with their own naming — `PEX\MyScript`,
 * interface keys — so a reference is only returned for real 4-character
 * subrecord signatures.
 */

export type SubrecordRef = {
  /** 4-char uppercase subrecord signature. */
  subrecord: string;
  /** Occurrence encoded in the path, when the path carries one. */
  index?: number;
};

const SUBRECORD_RE = /^([A-Za-z0-9_]{4})(?:\[(\d+)\])?$/;

/**
 * Extract the subrecord reference from a stored record path.
 *
 * @param path - Record path as stored in the DB, e.g. `TERM\ITXT` or `INNR\WNAM[1]`.
 * @returns Subrecord reference, or `null` when the path is not a plugin subrecord.
 */
export const parseSubrecordPath = (path: string | null | undefined): SubrecordRef | null => {
  if (!path) return null;
  const parts = path.replace(/\//g, '\\').split('\\');
  const field = parts[parts.length - 1] ?? '';
  const match = SUBRECORD_RE.exec(field);
  if (!match) return null;
  return {
    subrecord: match[1].toUpperCase(),
    index: match[2] === undefined ? undefined : Number(match[2]),
  };
};
