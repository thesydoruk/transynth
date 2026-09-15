import type { StringsType } from '../../types/StringsType';

/**
 * One title's record definitions, in the shape xTranslator's
 * `_recorddefs.txt` uses.
 *
 * `explicit` pins a `RECORD:FIELD` pair to a table; `fallbacks` pins a bare
 * field name (FULL, DESC, …) used when no explicit rule matched. `extends`
 * marks a file as an override layer applied after its base.
 */
export type RecorddefsJson = {
  extends?: string;
  explicit?: Array<[string, string, StringsType]>;
  fallbacks?: Array<[string, StringsType]>;
};

/** Compiled lookup: which STRINGS table an lstring id for a field lives in. */
export type CompiledRecorddefs = {
  tableFor(signature: string, field: string): StringsType;
};

/**
 * Compile a base-to-override chain of record definitions.
 *
 * Pass the chain base-first — Fallout 76 is `[fo4, fo76]`, Skyrim LE is
 * `[sse]`. Base layers are applied first, then any layer marked `extends`,
 * so an override wins over the base it refines.
 */
export const compileRecorddefs = (chain: readonly RecorddefsJson[]): CompiledRecorddefs => {
  const explicit = new Map<string, StringsType>();
  const fallbacks = new Map<string, StringsType>();

  const apply = (json: RecorddefsJson): void => {
    for (const [record, field, table] of json.explicit ?? []) {
      explicit.set(`${record}:${field}`, table);
    }
    for (const [field, table] of json.fallbacks ?? []) {
      fallbacks.set(field, table);
    }
  };

  for (const json of chain) if (!json.extends) apply(json);
  for (const json of chain) if (json.extends) apply(json);

  return {
    tableFor: (signature, field) =>
      explicit.get(`${signature}:${field}`) ?? fallbacks.get(field) ?? 'STRINGS',
  };
};

/** Extract the subrecord field name from a stored record path. */
export const subrecordFieldFromPath = (path: string | null | undefined): string => {
  if (!path) return '';
  const normalized = path.replace(/\//g, '\\');
  const parts = normalized.split('\\');
  const field = parts[parts.length - 1] ?? path;
  return field.replace(/\[\d+\]$/, '');
};

/** Resolve the strings table for an ESP import row (`signature` + stored `path`). */
export const resolveStringsTableTypeForRow = (
  recorddefs: CompiledRecorddefs,
  signature: string,
  path: string,
): StringsType => recorddefs.tableFor(signature, subrecordFieldFromPath(path));
