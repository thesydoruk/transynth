import { CONFIG } from '../../../../src/config';

/** Mask keys produced by placeholder / glossary / function-keyword masking. */
const MASK_TOKEN_RE = /¤(?:PH|GL|FK)\d+¤/g;

type Span = { start: number; end: number };

const maskTokenSpans = (text: string): Span[] => {
  const spans: Span[] = [];
  for (const match of text.matchAll(MASK_TOKEN_RE)) {
    if (match.index == null) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
};

const overlapsTokenInterior = (pos: number, spans: readonly Span[]): boolean =>
  spans.some((span) => pos > span.start && pos < span.end);

const isSafeCut = (pos: number, length: number, spans: readonly Span[]): boolean =>
  pos > 0 && pos < length && !overlapsTokenInterior(pos, spans);

/** Prefer paragraph breaks, then sentences, then whitespace — never inside mask tokens. */
const findCutPos = (text: string, maxEnd: number, spans: readonly Span[]): number => {
  const end = Math.min(maxEnd, text.length);
  if (end <= 0) return 0;

  const tryPatterns = [/\r\n\r\n/g, /\n\n/g, /(?<=[.!?…]["'»»]?)\s+/g, /(?<=[;:])\s+/g, /\s+/g];

  for (const pattern of tryPatterns) {
    let best = -1;
    for (const match of text.slice(0, end).matchAll(pattern)) {
      if (match.index == null) continue;
      const cut = match.index + match[0].length;
      if (cut <= 0 || cut > end) continue;
      if (!isSafeCut(cut, text.length, spans)) continue;
      if (cut > best) best = cut;
    }
    if (best > 0) return best;
  }

  for (let pos = end; pos > 0; pos--) {
    if (isSafeCut(pos, text.length, spans)) return pos;
  }

  return end;
};

/**
 * Split masked source text into parts that fit the LLM context window.
 * Cut points prefer paragraph and sentence boundaries and never split mask tokens.
 */
export const splitLongSourceText = (text: string, maxChars: number): string[] => {
  const limit = Math.max(1, maxChars);
  if (text.length <= limit) return [text];

  const spans = maskTokenSpans(text);
  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= limit) {
      parts.push(text.slice(start));
      break;
    }

    const localSpans = spans
      .filter((span) => span.end > start)
      .map((span) => ({
        start: Math.max(0, span.start - start),
        end: span.end - start,
      }));

    const cut = findCutPos(text.slice(start), limit, localSpans);
    const nextStart = start + Math.max(1, cut);
    parts.push(text.slice(start, nextStart));
    start = nextStart;
  }

  return parts.filter((part) => part.length > 0);
};

const countLineBreaks = (text: string): number => (text.match(/\r\n|\r|\n/g) ?? []).length;

const subdivideByLineBreakBudget = (
  text: string,
  maxChars: number,
  maxLineBreaks: number,
  out: string[],
): void => {
  if (text.length === 0) return;
  if (text.length <= maxChars && countLineBreaks(text) <= maxLineBreaks) {
    out.push(text);
    return;
  }
  if (text.length <= 80) {
    out.push(text);
    return;
  }

  const cut = findCutPos(
    text,
    Math.min(maxChars, Math.ceil(text.length / 2)),
    maskTokenSpans(text),
  );
  const nextStart = Math.max(1, cut);
  subdivideByLineBreakBudget(text.slice(0, nextStart), maxChars, maxLineBreaks, out);
  subdivideByLineBreakBudget(text.slice(nextStart), maxChars, maxLineBreaks, out);
};

/** Split raw source for translate — char limit plus a line-break budget per chunk. */
export const splitLongSourceForTranslate = (
  text: string,
  maxChars = CONFIG.llmTranslateTextChunkMaxChars,
  maxLineBreaks = CONFIG.llmTranslateTextChunkMaxLineBreaks,
): string[] => {
  const limit = Math.max(1, maxChars);
  if (text.length <= limit && countLineBreaks(text) <= maxLineBreaks) return [text];

  const out: string[] = [];
  for (const part of splitLongSourceText(text, limit)) {
    subdivideByLineBreakBudget(part, limit, maxLineBreaks, out);
  }
  return out.length > 0 ? out : [text];
};

export const needsLongTextSplit = (
  text: string,
  maxChars = CONFIG.llmTranslateTextChunkMaxChars,
): boolean => text.length > maxChars;

export const needsLongTextVerifySplit = (
  source: string,
  translation: string,
  maxChars = CONFIG.llmTranslateTextChunkMaxChars,
): boolean => source.length > maxChars || translation.length > maxChars;

export type LongTextPair = { source: string; translation: string };

const splitParagraphsKeepBreaks = (text: string): string[] => {
  if (!text) return [''];
  const chunks = text.split(/(\r\n\r\n|\n\n)/);
  if (chunks.length === 1) return [text];

  const paragraphs: string[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const body = chunks[i] ?? '';
    const breakSep = chunks[i + 1] ?? '';
    paragraphs.push(i + 2 < chunks.length ? body + breakSep : body);
  }
  return paragraphs.filter((part) => part.length > 0);
};

const packParagraphPairs = (
  source: string,
  translation: string,
  maxChars: number,
): LongTextPair[] | null => {
  const srcParas = splitParagraphsKeepBreaks(source);
  const transParas = splitParagraphsKeepBreaks(translation);
  if (srcParas.length !== transParas.length || srcParas.length <= 1) return null;

  const out: LongTextPair[] = [];
  let srcBuf = '';
  let transBuf = '';

  const flush = (): void => {
    if (srcBuf.length === 0 && transBuf.length === 0) return;
    out.push({ source: srcBuf, translation: transBuf });
    srcBuf = '';
    transBuf = '';
  };

  for (let i = 0; i < srcParas.length; i++) {
    const nextSrc = srcBuf + srcParas[i]!;
    const nextTrans = transBuf + transParas[i]!;
    if (srcBuf.length > 0 && nextSrc.length > maxChars) {
      flush();
      srcBuf = srcParas[i]!;
      transBuf = transParas[i]!;
    } else {
      srcBuf = nextSrc;
      transBuf = nextTrans;
    }
  }
  flush();

  if (out.length <= 1) return null;
  if (out.some((pair) => pair.source.length > maxChars || pair.translation.length > maxChars)) {
    return null;
  }
  return out;
};

const proportionalPairedSplit = (
  source: string,
  translation: string,
  maxChars: number,
): LongTextPair[] => {
  const sourceParts = splitLongSourceText(source, maxChars);
  if (sourceParts.length > 1) {
    const totalSource = Math.max(source.length, 1);
    let srcConsumed = 0;
    let transOffset = 0;
    return sourceParts.map((sourcePart, index) => {
      srcConsumed += sourcePart.length;
      const isLast = index === sourceParts.length - 1;
      const transEnd = isLast
        ? translation.length
        : Math.round(translation.length * (srcConsumed / totalSource));
      const transPart = translation.slice(transOffset, transEnd);
      transOffset = transEnd;
      return { source: sourcePart, translation: transPart };
    });
  }

  const transParts = splitLongSourceText(translation, maxChars);
  if (transParts.length <= 1) return [{ source, translation }];

  const totalTrans = Math.max(translation.length, 1);
  let transConsumed = 0;
  let srcOffset = 0;
  return transParts.map((transPart, index) => {
    transConsumed += transPart.length;
    const isLast = index === transParts.length - 1;
    const srcEnd = isLast
      ? source.length
      : Math.round(source.length * (transConsumed / totalTrans));
    const srcPart = source.slice(srcOffset, srcEnd);
    srcOffset = srcEnd;
    return { source: srcPart, translation: transPart };
  });
};

/** Split source/translation pairs for verify — paragraph-aligned when possible. */
export const splitLongPairedText = (
  source: string,
  translation: string,
  maxChars: number,
): LongTextPair[] => {
  const limit = Math.max(1, maxChars);
  if (source.length <= limit && translation.length <= limit) {
    return [{ source, translation }];
  }

  const paragraphPairs = packParagraphPairs(source, translation, limit);
  if (paragraphPairs) return paragraphPairs;

  return proportionalPairedSplit(source, translation, limit);
};
