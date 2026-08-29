import type { StringsType } from '../../types/StringsType';
import type { GameType } from '../../../types';
import fo4 from './fo4.json';
import fo76 from './fo76.json';
import sse from './sse.json';
import fnv from './fnv.json';

type RecorddefsJson = {
  extends?: string;
  explicit?: Array<[string, string, StringsType]>;
  fallbacks?: Array<[string, StringsType]>;
};

type CompiledRecorddefs = {
  explicit: Map<string, StringsType>;
  fallbacks: Map<string, StringsType>;
};

const PARENT: Partial<Record<GameType, GameType>> = {
  fo76: 'fo4',
  sle: 'sse',
  fo3: 'fnv',
  ob: 'fnv',
  mw: 'fnv',
};

const ROOT: Partial<Record<GameType, RecorddefsJson>> = {
  fo4: fo4 as RecorddefsJson,
  fo76: fo76 as RecorddefsJson,
  sse: sse as RecorddefsJson,
  fnv: fnv as RecorddefsJson,
};

const compileRecorddefs = (game: GameType): CompiledRecorddefs => {
  const chain: RecorddefsJson[] = [];
  const seen = new Set<GameType>();
  let current: GameType | undefined = game;

  while (current && !seen.has(current)) {
    seen.add(current);
    const json = ROOT[current];
    if (json) chain.unshift(json);
    current = PARENT[current];
  }

  if (chain.length === 0) {
    chain.push(fo4 as RecorddefsJson);
  }

  const explicit = new Map<string, StringsType>();
  const fallbacks = new Map<string, StringsType>();

  for (const json of chain) {
    if (json.extends) continue;
    for (const [record, field, table] of json.explicit ?? []) {
      explicit.set(`${record}:${field}`, table);
    }
    for (const [field, table] of json.fallbacks ?? []) {
      fallbacks.set(field, table);
    }
  }

  for (const json of chain) {
    if (!json.extends) continue;
    for (const [record, field, table] of json.explicit ?? []) {
      explicit.set(`${record}:${field}`, table);
    }
    for (const [field, table] of json.fallbacks ?? []) {
      fallbacks.set(field, table);
    }
  }

  return { explicit, fallbacks };
};

const CACHE = new Map<GameType, CompiledRecorddefs>();

const getCompiled = (game: GameType): CompiledRecorddefs => {
  const cached = CACHE.get(game);
  if (cached) return cached;
  const compiled = compileRecorddefs(game);
  CACHE.set(game, compiled);
  return compiled;
};

/** Extract the subrecord field name from a stored record path. */
export const subrecordFieldFromPath = (path: string | null | undefined): string => {
  if (!path) return '';
  const normalized = path.replace(/\//g, '\\');
  const parts = normalized.split('\\');
  const field = parts[parts.length - 1] ?? path;
  return field.replace(/\[\d+\]$/, '');
};

/**
 * Resolve which Bethesda strings table holds an lstring id for a record field.
 *
 * Rules follow xTranslator `_recorddefs.txt` per game (explicit REC:FIELD first,
 * then FULL/DESC/ATTX fallbacks).
 */
export const resolveStringsTableType = (
  game: GameType,
  signature: string,
  field: string,
): StringsType => {
  const { explicit, fallbacks } = getCompiled(game);
  const hit = explicit.get(`${signature}:${field}`);
  if (hit) return hit;
  const fallback = fallbacks.get(field);
  if (fallback) return fallback;
  return 'STRINGS';
};

/**
 * Resolve strings table type from an ESP import row (`signature` + `path`).
 */
export const resolveStringsTableTypeForRow = (
  game: GameType,
  signature: string,
  path: string,
): StringsType => resolveStringsTableType(game, signature, subrecordFieldFromPath(path));
