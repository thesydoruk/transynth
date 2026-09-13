/**
 * Split protected game tokens out of source text so the LLM translates
 * string parts and only echoes integer slot ids. The pipeline joins slots back.
 */
import { maskTranslateSource } from './llmTextMask';
import type { GameType } from '../types';
import { MASK_KEY_RE, PLACEHOLDER_RE, type ProtectedTokenContext } from '../utils/placeholders';

export type LlmSlotKind =
  | 'break'
  | 'alias'
  | 'global'
  | 'printf'
  | 'var'
  | 'tag'
  | 'keyword'
  | 'markup';

export type LlmTextPart = string | number;

export type LlmTextSlot = {
  i: number;
  raw: string;
  kind: LlmSlotKind;
};

export type LlmSlotHint = {
  i: number;
  kind: LlmSlotKind;
};

const maskKeyRe = (): RegExp => new RegExp(MASK_KEY_RE.source, 'g');
const placeholderRe = (): RegExp => new RegExp(PLACEHOLDER_RE.source, 'g');

export const classifySlotKind = (raw: string, maskKey?: string): LlmSlotKind => {
  if (maskKey && /^¤(?:IT|Q|TS|EM)\d+¤$/.test(maskKey)) return 'markup';
  if (maskKey && /^¤FK\d+¤$/.test(maskKey)) return 'keyword';
  if (/^(?:\r\n|\r|\n)/.test(raw)) return 'break';
  if (raw.startsWith('<Alias')) return 'alias';
  if (raw.startsWith('<Global')) return 'global';
  if (raw.startsWith('%')) return 'printf';
  if (raw.startsWith('{') || raw.startsWith('$')) return 'var';
  if (raw.startsWith('<font')) return 'markup';
  return 'tag';
};

export const publicSlotHints = (slots: readonly LlmTextSlot[]): LlmSlotHint[] =>
  slots.map(({ i, kind }) => ({ i, kind }));

export const splitMaskedToParts = (
  masked: string,
  mapping: Record<string, string>,
): { parts: LlmTextPart[]; slots: LlmTextSlot[]; keyToIndex: Map<string, number> } => {
  const slots: LlmTextSlot[] = [];
  const keyToIndex = new Map<string, number>();
  const parts: LlmTextPart[] = [];
  const re = maskKeyRe();
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked))) {
    if (match.index > last) parts.push(masked.slice(last, match.index));
    const key = match[0]!;
    let index = keyToIndex.get(key);
    if (index == null) {
      const raw = mapping[key];
      if (raw == null) {
        parts.push(key);
        last = match.index + key.length;
        continue;
      }
      index = slots.length;
      keyToIndex.set(key, index);
      slots.push({ i: index, raw, kind: classifySlotKind(raw, key) });
    }
    parts.push(index);
    last = match.index + key.length;
  }
  if (last < masked.length) parts.push(masked.slice(last));
  if (parts.length === 0) parts.push(masked);
  return { parts, slots, keyToIndex };
};

/** Walk a masked string using slot ids already assigned from the source. */
export const splitMaskedUsingKeys = (
  masked: string,
  keyToIndex: Map<string, number>,
): LlmTextPart[] => {
  const parts: LlmTextPart[] = [];
  const re = maskKeyRe();
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked))) {
    if (match.index > last) parts.push(masked.slice(last, match.index));
    const index = keyToIndex.get(match[0]!);
    parts.push(index ?? match[0]!);
    last = match.index + match[0]!.length;
  }
  if (last < masked.length) parts.push(masked.slice(last));
  return parts.length > 0 ? parts : [masked];
};

export const assembleTranslatedText = (
  rawParts: unknown,
  rawTranslation: unknown,
  sourceParts?: readonly LlmTextPart[] | null,
  restoreSlots?: readonly LlmTextSlot[] | null,
): string | null => {
  const parsedParts = parseLlmParts(rawParts);
  if (parsedParts) {
    if (restoreSlots && restoreSlots.length > 0 && sourceParts) {
      const check = validateTranslatedParts(sourceParts, parsedParts, restoreSlots);
      if (!check.ok) return null;
      const joined = joinParts(parsedParts, restoreSlots);
      return joined.trim() === '' ? null : joined;
    }
    if (parsedParts.some((part) => typeof part === 'number')) return null;
    const joined = parsedParts.filter((part): part is string => typeof part === 'string').join('');
    return joined.trim() === '' ? null : joined;
  }
  if (typeof rawTranslation === 'string' && rawTranslation.trim() !== '') {
    return rawTranslation;
  }
  return null;
};

export const splitTranslateSource = (
  text: string,
  game?: GameType | string | null,
  context?: ProtectedTokenContext | null,
): {
  parts: LlmTextPart[];
  slots: LlmTextSlot[];
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
} => {
  const masked = maskTranslateSource(text, game, context);
  const mapping = { ...masked.placeholderMap, ...masked.functionKeywordMap };
  const { parts, slots } = splitMaskedToParts(masked.masked, mapping);
  return {
    parts,
    slots,
    placeholderMap: masked.placeholderMap,
    functionKeywordMap: masked.functionKeywordMap,
  };
};

export const formatPartsTemplate = (parts: readonly LlmTextPart[]): string =>
  parts.map((part) => (typeof part === 'number' ? `{${part}}` : part)).join('');

export const hasTranslatableParts = (parts: readonly LlmTextPart[]): boolean =>
  parts.some((part) => typeof part === 'string' && part.trim() !== '');

export const isMaskedLlmText = (text: string): boolean => maskKeyRe().test(text);

export const joinParts = (parts: readonly LlmTextPart[], slots: readonly LlmTextSlot[]): string => {
  const rawByIndex = new Map(slots.map((slot) => [slot.i, slot.raw]));
  return parts
    .map((part) => (typeof part === 'number' ? (rawByIndex.get(part) ?? '') : part))
    .join('');
};

export const slotIndexMultiset = (parts: readonly LlmTextPart[]): number[] =>
  parts.filter((part): part is number => typeof part === 'number').sort((a, b) => a - b);

export const parseLlmParts = (value: unknown): LlmTextPart[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts: LlmTextPart[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0) {
      parts.push(entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const row = entry as { t?: unknown; i?: unknown };
      if (typeof row.t === 'string') {
        parts.push(row.t);
        continue;
      }
      if (typeof row.i === 'number' && Number.isInteger(row.i) && row.i >= 0) {
        parts.push(row.i);
        continue;
      }
    }
    return null;
  }
  return parts;
};

export const validateTranslatedParts = (
  sourceParts: readonly LlmTextPart[],
  translatedParts: readonly LlmTextPart[],
  slots: readonly LlmTextSlot[],
): { ok: true } | { ok: false; message: string } => {
  const expected = slotIndexMultiset(sourceParts);
  const got = slotIndexMultiset(translatedParts);
  if (expected.join(',') !== got.join(',')) {
    return {
      ok: false,
      message: `Slot index mismatch: expected=[${expected.join(', ')}] got=[${got.join(', ')}]`,
    };
  }
  const known = new Set(slots.map((slot) => slot.i));
  for (const index of got) {
    if (!known.has(index)) {
      return { ok: false, message: `Unknown slot index ${index}` };
    }
  }
  for (const part of translatedParts) {
    if (typeof part !== 'string') continue;
    if (maskKeyRe().test(part) || placeholderRe().test(part)) {
      return { ok: false, message: 'Protected token leaked into a text part' };
    }
  }
  return { ok: true };
};

/** Map a translated/raw string onto the source slot ids (same raw token → same index). */
export const alignTextToSlots = (
  text: string,
  sourceSlots: readonly LlmTextSlot[],
  game?: GameType | string | null,
  context?: ProtectedTokenContext | null,
): LlmTextPart[] => {
  const split = splitTranslateSource(text, game, context);
  const idsByRaw = new Map<string, number[]>();
  for (const slot of sourceSlots) {
    const list = idsByRaw.get(slot.raw) ?? [];
    list.push(slot.i);
    idsByRaw.set(slot.raw, list);
  }
  const used = new Map<string, number>();
  const rawBySplitIndex = new Map(split.slots.map((slot) => [slot.i, slot.raw]));
  return split.parts.map((part) => {
    if (typeof part === 'string') return part;
    const raw = rawBySplitIndex.get(part);
    if (raw == null) return part;
    const ids = idsByRaw.get(raw);
    if (!ids || ids.length === 0) return part;
    const n = used.get(raw) ?? 0;
    used.set(raw, n + 1);
    return ids[Math.min(n, ids.length - 1)]!;
  });
};

export const compactLlmPartsFields = (
  parts?: readonly LlmTextPart[] | null,
  slots?: readonly LlmSlotHint[] | null,
): { parts: LlmTextPart[]; slots?: LlmSlotHint[] } | Record<string, never> => {
  if (!parts || parts.length === 0) return {};
  return {
    parts: [...parts],
    ...(slots && slots.length > 0 ? { slots: [...slots] } : {}),
  };
};

export const applyTranslateSplit = <
  T extends {
    source: string;
    parts?: LlmTextPart[];
    sourceParts?: LlmTextPart[];
    slots?: LlmSlotHint[];
    restoreSlots?: LlmTextSlot[];
  },
>(
  item: T,
  split: { parts: LlmTextPart[]; slots: LlmTextSlot[] },
): T => ({
  ...item,
  source: formatPartsTemplate(split.parts),
  parts: split.parts,
  sourceParts: split.parts,
  slots: publicSlotHints(split.slots),
  restoreSlots: split.slots,
});

export const structureLlmReferenceExamples = <T extends { source: string; translation: string }>(
  examples: T[] | undefined,
  game?: GameType | string | null,
):
  | Array<T & { parts: LlmTextPart[]; translation_parts: LlmTextPart[]; slots: LlmSlotHint[] }>
  | undefined => {
  if (!examples?.length) return undefined;
  return examples.map((example) => {
    const split = splitTranslateSource(example.source, game);
    const translationParts = alignTextToSlots(example.translation, split.slots, game);
    return {
      ...example,
      source: formatPartsTemplate(split.parts),
      translation: formatPartsTemplate(translationParts),
      parts: split.parts,
      translation_parts: translationParts,
      slots: publicSlotHints(split.slots),
    };
  });
};
