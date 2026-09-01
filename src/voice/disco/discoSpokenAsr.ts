/**
 * Decide which lockit span the English clip actually speaks, from Whisper ASR.
 *
 * Whisper is noisy: dropped prefixes, scribble/scribbled, extra fillers, and
 * stretched interjections (`Yeaaahhhh` → `yeah`). Tokens are matched fuzzily.
 *
 * The narration is judged by its own distinctive words, not by comparing whole
 * lines: a long quote plus a short stage direction scores nearly the same
 * either way, so an F1 margin would keep such lines whole forever. Narration
 * words present in the transcript mean the clip reads them (item and thought
 * descriptions); absent means it does not (an actor voicing only their speech).
 * Prose transcribes far more reliably than a two-word take, so once enough
 * narration words are missing the quote need not be recognizable itself —
 * `Okay.` against a transcript of `OK` no longer needs a synonym table.
 *
 * Without any transcript the line stays whole, except when narration sits
 * *between* two quotes (`"Really?" She believes you. "You seem…"`): that middle
 * is never in the clip. A transcript that came back empty is itself evidence —
 * prose is always recognizable, so a silent-but-for-a-grunt clip (`"Uh…" She
 * doesn't know what to say.`) speaks the quotes only. A low-confidence take
 * reads the same way: the score is low *because* the clip is a grunt, so an
 * unheard stage direction still counts as absent, though such a transcript is
 * never trusted to say which of several quotes was the spoken one. For the same
 * reason a quote holding nothing but a short or drawn-out sound is never dropped
 * for being absent: only spans with a real word can be ruled out of the clip.
 */
import {
  extractDiscoQuoteSpans,
  hasDiscoNarrationOutsideQuotes,
} from '../../formats/po/discoLockitMarkup';

export type DiscoSpokenMode = 'full' | 'quoted' | 'custom';

export type DiscoSpokenAsrDecision = {
  mode: DiscoSpokenMode;
  spokenSource: string;
  /** Quote-span indexes in lockit order; set for `quoted` / `custom`. */
  quoteIndexes?: number[];
};

type QuoteHypothesis = {
  mode: 'quoted' | 'custom';
  indexes: number[];
  spokenSource: string;
};

export type DecideDiscoSpokenAsrOptions = {
  /** audio-intel overall confidence, 0–1; ignored when null. */
  confidence?: number | null;
  /**
   * audio-intel returned a transcript for this clip, even an empty one.
   * Distinguishes "heard no speech" from "never asked / service down".
   */
  transcribed?: boolean;
};

const LOW_CONFIDENCE = 0.35;
/** Below this the transcript explains no candidate, so nothing can be cut. */
const MIN_QUOTE_F1 = 0.5;
const NARRATION_FULL = 0.35;
const NARRATION_BLOCK_QUOTE = 0.25;
/** Shortest word Whisper spells consistently enough to be evidence. */
const MIN_EVIDENCE_LENGTH = 4;

/** `yeaaahhhh` / `nooooo` → `yeah` / `no`. Leaves `see` / `hello` intact. */
const squeezeElongation = (token: string): string => token.replace(/([aeiouhy])\1{2,}/gi, '$1');

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0)
    .map(squeezeElongation);

const uniq = (tokens: string[]): string[] => [...new Set(tokens)];

/**
 * Words long enough to weigh as evidence. Short ones are both the most common
 * and the most fuzzily matched, so their presence proves nothing.
 */
const contentTokens = (text: string): string[] =>
  tokenize(text).filter((t) => t.length >= MIN_EVIDENCE_LENGTH);

/** Drop drawn-out words: Whisper respells or skips them at will. */
const dropElongated = (text: string): string =>
  text.replace(/[\p{L}]*([\p{L}])\1{2,}[\p{L}]*/gu, ' ');

const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[n]!;
};

const foldAsrToken = (token: string): string => squeezeElongation(token.toLowerCase());

/** Exact, elongation, stem prefix, or small edit — typical Whisper substitutions. */
export const discoAsrTokensMatch = (left: string, right: string): boolean => {
  const a = foldAsrToken(left);
  const b = foldAsrToken(right);
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.startsWith(shorter) && longer.length - shorter.length <= 2) {
    return true;
  }
  const maxDist = longer.length >= 8 ? 2 : longer.length >= 5 ? 1 : 0;
  return maxDist > 0 && editDistance(a, b) <= maxDist;
};

const fuzzyIntersect = (asrTokens: string[], candidateTokens: string[]): number => {
  const used = new Set<number>();
  let hits = 0;
  for (const token of asrTokens) {
    const idx = candidateTokens.findIndex((c, i) => !used.has(i) && discoAsrTokensMatch(token, c));
    if (idx >= 0) {
      used.add(idx);
      hits += 1;
    }
  }
  return hits;
};

const tokenF1 = (asr: string, candidate: string): number => {
  const a = uniq(tokenize(asr));
  const b = uniq(tokenize(candidate));
  if (a.length === 0 || b.length === 0) return 0;
  const hits = fuzzyIntersect(a, b);
  const precision = hits / a.length;
  const recall = hits / b.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
};

const stripQuoteSpans = (text: string): string => {
  const spans = extractDiscoQuoteSpans(text);
  let rest = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
  }
  return rest;
};

/** `"Quote." Stage direction. "Quote."` — the middle is not voiced. */
export const hasInterstitialDiscoNarration = (text: string): boolean => {
  const spans = extractDiscoQuoteSpans(text);
  if (spans.length < 2) return false;
  const mid = text.slice(spans[0]!.end, spans[spans.length - 1]!.start);
  return /[\p{L}\p{N}]/u.test(mid);
};

/**
 * A span may be declared unspoken only when it holds a word Whisper would
 * render. Bare interjections (`"Uh..."`, `"Yeaaahhhh..."`) are dropped or
 * respelled freely, so their absence is no evidence at all.
 */
const spanAbsenceIsProvable = (content: string): boolean =>
  contentTokens(dropElongated(content)).length > 0;

const allQuotesDecision = (source: string): DiscoSpokenAsrDecision => {
  const spans = extractDiscoQuoteSpans(source);
  return {
    mode: 'quoted',
    spokenSource: spans.map((s) => s.content).join(' '),
    quoteIndexes: spans.map((_, i) => i),
  };
};

/** Single quotes, contiguous ranges, and the full quoted join. */
export const discoQuoteHypotheses = (source: string): QuoteHypothesis[] => {
  const spans = extractDiscoQuoteSpans(source);
  if (spans.length === 0) return [];
  const allIndexes = spans.map((_, i) => i);
  const hyps: QuoteHypothesis[] = [
    {
      mode: 'quoted',
      indexes: allIndexes,
      spokenSource: spans.map((s) => s.content).join(' '),
    },
  ];
  if (spans.length < 2) return hyps;
  for (let start = 0; start < spans.length; start++) {
    for (let end = start; end < spans.length; end++) {
      if (start === 0 && end === spans.length - 1) continue;
      const indexes = Array.from({ length: end - start + 1 }, (_, k) => start + k);
      hyps.push({
        mode: 'custom',
        indexes,
        spokenSource: indexes.map((i) => spans[i]!.content).join(' '),
      });
    }
  }
  return hyps;
};

/**
 * Map an English ASR transcript onto full lockit text, all quotes, or a
 * subset of quote spans (`custom`). Defaults to `full` when ASR is missing or
 * too close to call; a low-confidence transcript can still rule the narration
 * out, but never narrows the choice to a single quote.
 */
export const decideDiscoSpokenFromAsr = (
  source: string,
  asrText: string | null | undefined,
  options: DecideDiscoSpokenAsrOptions = {},
): DiscoSpokenAsrDecision => {
  const spans = extractDiscoQuoteSpans(source);
  const mixed = hasDiscoNarrationOutsideQuotes(source);
  if (spans.length === 0 || (!mixed && spans.length < 2)) {
    return { mode: 'full', spokenSource: source };
  }

  const asr = asrText?.trim() ?? '';
  const interstitial = hasInterstitialDiscoNarration(source);
  const structural = (): DiscoSpokenAsrDecision =>
    interstitial ? allQuotesDecision(source) : { mode: 'full', spokenSource: source };
  // An empty transcript from a working service means no prose was audible.
  if (!asr) return options.transcribed === true ? allQuotesDecision(source) : structural();

  const quoted = spans.map((s) => s.content).join(' ');
  const narration = stripQuoteSpans(source);
  const quotedTok = tokenize(quoted);
  const narrDistinct = contentTokens(narration).filter(
    (n) => !quotedTok.some((q) => discoAsrTokensMatch(n, q)),
  );
  const asrTok = tokenize(asr);
  const narrHits = narrDistinct.filter((n) => asrTok.some((a) => discoAsrTokensMatch(n, a))).length;
  const narrCoverage = narrDistinct.length === 0 ? 0 : narrHits / narrDistinct.length;

  const confidence = options.confidence;
  if (confidence != null && Number.isFinite(confidence) && confidence < LOW_CONFIDENCE) {
    // A garbled take still says what it does *not* hold: prose would have come
    // back. Which span was spoken it cannot say, so every quote stays.
    return narrDistinct.length > 0 && narrCoverage < NARRATION_BLOCK_QUOTE
      ? allQuotesDecision(source)
      : structural();
  }

  const fullScore = tokenF1(asr, source);
  if (narrCoverage >= NARRATION_FULL) return { mode: 'full', spokenSource: source };

  const omissible = new Set(
    spans.flatMap((span, i) => (spanAbsenceIsProvable(span.content) ? [i] : [])),
  );
  const scored = discoQuoteHypotheses(source)
    .filter((hyp) => spans.every((_, i) => hyp.indexes.includes(i) || omissible.has(i)))
    .map((hyp) => ({
      hyp,
      score: tokenF1(asr, hyp.spokenSource),
    }))
    .sort((a, b) => b.score - a.score || b.hyp.spokenSource.length - a.hyp.spokenSource.length);
  const best = scored[0];
  if (best && narrCoverage < NARRATION_BLOCK_QUOTE) {
    // A stage direction whose words went untranscribed is not in the clip,
    // whatever the quote itself scored. When it has no word that could serve as
    // evidence — one short token, or one confusable with the quote's own words
    // (`He sighs.` against `neon signs`) — a quote that fits the transcript is
    // all there is to go on, and a stage direction is the likelier reading.
    if (narrDistinct.length > 0 || best.score >= MIN_QUOTE_F1) {
      return {
        mode: best.hyp.mode,
        spokenSource: best.hyp.spokenSource,
        quoteIndexes: best.hyp.indexes,
      };
    }
  }
  // Interstitial narration is structurally unspoken, so quotes win ties — but
  // not when the transcript really does explain the whole line better.
  if (interstitial && narrCoverage < NARRATION_FULL && tokenF1(asr, quoted) >= fullScore) {
    return allQuotesDecision(source);
  }
  return { mode: 'full', spokenSource: source };
};
