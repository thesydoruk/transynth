/**
 * Compact MCM menu context for LLM translate/verify.
 *
 * Stored on `strings.context` at import (like PEX snippets) and rebuilt at
 * translate time from sibling `$key` / `$key_help` rows when context is empty.
 * Never dumps the whole menu — only page, control type, and the paired label/help.
 */

export type McmKeyMeta = {
  page?: string;
  type?: string;
  /** Paired help/tooltip when this key is a control label. */
  help?: string;
  /** Paired label when this key is help/tooltip. */
  label?: string;
};

export type McmPairRole = 'label' | 'help';

export type McmPairKey = {
  base: string;
  role: McmPairRole;
};

const HELP_SUFFIXES = ['_help', '_desc', '_tip', '_info', '_description'] as const;

const PAGE_DISPLAY_NAME_RE = /^\$Page(\d+)_DisplayName$/i;
const PAGE_SCOPED_KEY_RE = /^\$Page(\d+)_/i;

const CONTEXT_VALUE_MAX = 180;

const isStubText = (value: string): boolean => value.startsWith('$');

/** `$SettingDifficulty_help` → base `$SettingDifficulty`, role help. */
export const parseMcmPairKey = (key: string): McmPairKey => {
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  for (const suffix of HELP_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return { base: trimmed.slice(0, trimmed.length - suffix.length), role: 'help' };
    }
  }
  return { base: trimmed, role: 'label' };
};

/** Last path segment when it is an MCM `$key`. */
export const mcmKeyFromRecordPath = (path: string | null | undefined): string | null => {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\\+/);
  const key = parts[parts.length - 1];
  return key?.startsWith('$') ? key : null;
};

export const truncateMcmContextValue = (value: string, max = CONTEXT_VALUE_MAX): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
};

const usablePairText = (
  value: string | undefined,
  texts?: Map<string, string>,
): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || isStubText(trimmed)) {
    if (trimmed && texts?.has(trimmed)) {
      const resolved = texts.get(trimmed)!.trim();
      if (resolved && !isStubText(resolved)) return resolved;
    }
    return undefined;
  }
  return trimmed;
};

const findPairedHelpText = (baseKey: string, texts: Map<string, string>): string | undefined => {
  for (const suffix of HELP_SUFFIXES) {
    const hit = usablePairText(texts.get(`${baseKey}${suffix}`), texts);
    if (hit) return hit;
  }
  return undefined;
};

const pageTitlesFromTexts = (texts: Map<string, string>): Map<string, string> => {
  const titles = new Map<string, string>();
  for (const [key, text] of texts) {
    const match = key.match(PAGE_DISPLAY_NAME_RE);
    const title = usablePairText(text, texts);
    if (match && title) titles.set(match[1]!, title);
  }
  return titles;
};

const pageFromKey = (key: string, pageTitles: Map<string, string>): string | undefined => {
  if (PAGE_DISPLAY_NAME_RE.test(key)) return undefined;
  const match = key.match(PAGE_SCOPED_KEY_RE);
  if (!match) return undefined;
  return pageTitles.get(match[1]!);
};

const mergeMcmKeyMeta = (base: McmKeyMeta, overlay?: McmKeyMeta): McmKeyMeta => ({
  page: overlay?.page || base.page,
  type: overlay?.type || base.type,
  help: overlay?.help || base.help,
  label: overlay?.label || base.label,
});

/** Compact `page=…; type=…; help=…` line, or null when nothing useful is known. */
export const formatMcmStoredContext = (meta: McmKeyMeta): string | null => {
  const parts: string[] = [];
  if (meta.page) parts.push(`page=${truncateMcmContextValue(meta.page, 80)}`);
  if (meta.type) parts.push(`type=${truncateMcmContextValue(meta.type, 40)}`);
  if (meta.help) parts.push(`help=${truncateMcmContextValue(meta.help)}`);
  if (meta.label) parts.push(`label=${truncateMcmContextValue(meta.label)}`);
  return parts.length > 0 ? parts.join('; ') : null;
};

const buildMcmKeyMeta = (
  key: string,
  texts: Map<string, string>,
  configMeta?: McmKeyMeta,
  pageTitles?: Map<string, string>,
): McmKeyMeta => {
  const { base, role } = parseMcmPairKey(key);
  const titles = pageTitles ?? pageTitlesFromTexts(texts);
  const fromMap: McmKeyMeta = {
    page: pageFromKey(key, titles),
    help: role === 'label' ? findPairedHelpText(base, texts) : undefined,
    label: role === 'help' ? usablePairText(texts.get(base), texts) : undefined,
  };
  const merged = mergeMcmKeyMeta(fromMap, configMeta);
  const resolved: McmKeyMeta = {
    page: usablePairText(merged.page, texts),
    type: merged.type && !isStubText(merged.type) ? merged.type : undefined,
    help: usablePairText(merged.help, texts),
    label: usablePairText(merged.label, texts),
  };
  const selfText = texts.get(key);
  if (resolved.help && selfText === resolved.help) delete resolved.help;
  if (resolved.label && selfText === resolved.label) delete resolved.label;
  return resolved;
};

export const buildMcmContexts = (
  texts: Map<string, string>,
  configMeta?: Map<string, McmKeyMeta>,
): Map<string, string> => {
  const out = new Map<string, string>();
  const pageTitles = pageTitlesFromTexts(texts);
  for (const key of texts.keys()) {
    const formatted = formatMcmStoredContext(
      buildMcmKeyMeta(key, texts, configMeta?.get(key), pageTitles),
    );
    if (formatted) out.set(key, formatted);
  }
  return out;
};

/** Keep stored import context; otherwise build a compact pair/page line from siblings. */
export const resolveMcmLlmContext = (
  stored: string | null | undefined,
  key: string | null | undefined,
  siblingTexts: Map<string, string>,
): string | null => {
  const existing = stored?.trim();
  if (existing) return existing;
  if (!key) return null;
  return formatMcmStoredContext(buildMcmKeyMeta(key, siblingTexts));
};

/**
 * Pull later `$Foo_help` next to the first `$Foo` without reshuffling unrelated rows.
 */
export const groupMcmPairsForTranslate = <
  T extends { grup: string | null; field: string | null; stringId: number },
>(
  items: T[],
): T[] => {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];

  for (const item of items) {
    const key =
      item.grup === 'MCM' && item.field
        ? `mcm:${parseMcmPairKey(item.field).base}`
        : `row:${item.stringId}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
      continue;
    }
    buckets.set(key, [item]);
    order.push(key);
  }

  return order.flatMap((key) => buckets.get(key) ?? []);
};
