/**
 * LLM audit — flags source strings that should not be translated.
 */
import { CONFIG } from '../config';
import { log } from '../logger';
import { chatWithFallback } from './index';
import { parseLlmJson } from './jsonParse';
import { buildSkipDetectResponseFormat } from './responseSchemas';
import type { ChatCompletionMeta } from './provider';
import { isAbortError } from './retry';
import type { GameType } from '../types';
import { parseVerifyItemId } from './verifyTranslate';

export type LlmSkipDetectVerdict = 'skip' | 'keep';

export interface LlmSkipDetectItem {
  id: number;
  source: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  path: string | null;
  context: string | null;
}

export interface LlmSkipDetectItemResult {
  id: number;
  verdict: LlmSkipDetectVerdict;
  reason: string;
  confidence: number;
}

export interface LlmSkipDetectOptions {
  items: LlmSkipDetectItem[];
  model: string;
  srcLang: string;
  game?: GameType | string | null;
  modName?: string | null;
  /** Aborts the in-flight LLM request when the owning job is stopped. */
  signal?: AbortSignal;
}

const VALID_VERDICTS = new Set<LlmSkipDetectVerdict>(['skip', 'keep']);

export const buildSkipDetectSystemPrompt = (
  srcLang: string,
  game?: GameType | string | null,
): string => {
  const title = game ? `${game} / Bethesda` : 'Bethesda';

  return [
    `You are an expert ${title} localization engineer auditing which source strings (${srcLang}) should NOT be translated at all.`,
    'Skip marks are global: a flagged row must stay as source text in every localized output, regardless of target language.',
    '',
    '### SECOND PASS (read first):',
    '- Every input row already passed a fast heuristic scan. Obvious non-translatable rows were removed upstream: empty/placeholder-only text, markup-only strings, REFR/KYWD/INNR/LVLI/ARMA records, FormID-like hex, file paths, MPS/LightNode internal names, pure numbers/symbols, editor-ID duplicates, short stat codes, and many PEX debug literals.',
    '- You only see borderline rows the heuristics could not decide confidently.',
    '- Use verdict "skip" ONLY when you are clearly certain the string must never be translated in any language.',
    '- False "skip" is worse than false "keep": wrongly skipping hides real player text from translators.',
    '- When uncertain, always choose "keep".',
    '',
    '### TECHNICAL REQUIREMENTS:',
    '- Input: JSON with metadata and an "items" array (id, source, grup, field, path, edid, context).',
    '- Output: valid JSON ONLY. No markdown fences.',
    '- Return one object per input id.',
    '- The declared source_language is not always accurate — some rows may already be partly localized. Judge by the actual content, not by the declared language alone.',
    '- Use grup, field, path, edid, and context together — do not rely on the source string alone.',
    '',
    '### VERDICT:',
    '- "skip": do not translate — leave source as-is in the game files (high bar; see SECOND PASS).',
    '- "keep": normal translatable or reviewable player-facing text (default).',
    '',
    '### CONTEXT GUIDE (Creation Kit / ESP):',
    '- grup = record type (ACTI, WEAP, INFO, GMST, …); field/path = which sub-field (FULL, DESC, NAM1, DATA, …).',
    '- edid = editor ID of the record — hints at purpose but does NOT override readable player text.',
    '- context = speaker / scene hint; for PEX, often decompiled .psc lines around the literal.',
    '- Player-facing: INFO/DIAL (dialogue), BOOK, WEAP/ARMO FULL (items), quest stages, most UI strings.',
    '',
    '### SKIP (second pass — only when clearly non-translatable):',
    '- PEX (grup = PEX): context shows Debug.Trace / TraceStack, RegisterForAnimationEvent / RegisterForCustomEvent names, or other log-only wiring — not MessageBox, Notification, or UI shown to the player.',
    '- ACTI/MSTT/EFSH FULL that is unambiguously an internal engine/node identifier (dense camelCase token, particle wiring) — NOT a real place name or sign (e.g. keep "Somerville Place" on ACTI).',
    '- Source text has no player-readable meaning even after reading context — pure internal wiring with no words a player should see.',
    '',
    '### KEEP (prefer this — especially on borderline rows):',
    '- Any readable words meant for the player: dialogue, item/weapon/armor names, descriptions, books, notes, quest text, UI labels.',
    '- Proper names, location names, character names — even on ACTI or unusual record types.',
    '- Plain words that happen to match edid (e.g. "Minigun", "Patrick", "Caretaker") — names are translatable.',
    '- Bracketed stage directions / tone tags: "[Sarcasm]", "[Whispering]", "[Impatiently]".',
    '- Prose with angle brackets: "<User \\"Bergman\\" signed in>", "<***Using ICE-Breaker***>".',
    '- Strings mixing markup with real words: "Help defend <Alias=myLocation>".',
    '- Text already partly or fully in another language — still keep unless it is clearly pure technical junk with no player-facing wording.',
    '- If grup/edid looks technical but the source reads like normal language → keep.',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":1,"verdict":"skip","reason":"…","confidence":0.95},{"id":2,"verdict":"keep","reason":"…","confidence":0.9}]}',
  ].join('\n');
};

export const buildSkipDetectUserPayload = (opts: Omit<LlmSkipDetectOptions, 'model'>): object => ({
  task: 'non_translatable_audit',
  audit_pass: 'llm_second',
  source_language: opts.srcLang.trim().toLowerCase(),
  game: opts.game ?? null,
  mod_name: opts.modName ?? null,
  items: opts.items.map((item) => ({
    id: item.id,
    source: item.source,
    grup: item.grup,
    edid: item.edid,
    field: item.field,
    path: item.path,
    context: item.context,
  })),
});

const clampConfidence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const parseVerdict = (value: unknown): LlmSkipDetectVerdict => {
  if (typeof value === 'string' && VALID_VERDICTS.has(value as LlmSkipDetectVerdict)) {
    return value as LlmSkipDetectVerdict;
  }
  return 'keep';
};

const parseSkipItemsFromRaw = (
  raw: string,
  expectedIds?: number[],
  completionMeta?: ChatCompletionMeta,
): Map<number, LlmSkipDetectItemResult> => {
  const parsed = parseLlmJson(raw, {
    operation: 'skip_detect',
    ...(expectedIds
      ? {
          itemIds: expectedIds,
          itemCount: expectedIds.length,
          finishReason: completionMeta?.finishReason,
          completionTokens: completionMeta?.completionTokens,
        }
      : {}),
  });

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM skip-detect response must be a JSON object');
  }

  const body = parsed as Record<string, unknown>;
  const rawItems = body.items;
  if (!Array.isArray(rawItems)) {
    throw new Error('LLM skip-detect response must contain an "items" array');
  }

  const byId = new Map<number, LlmSkipDetectItemResult>();
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = parseVerifyItemId(row.id);
    if (id == null) continue;
    const verdict = parseVerdict(row.verdict);
    byId.set(id, {
      id,
      verdict,
      reason:
        typeof row.reason === 'string' && row.reason.trim()
          ? row.reason.trim()
          : verdict === 'skip'
            ? 'Should not be translated.'
            : 'Translatable text.',
      confidence: clampConfidence(row.confidence),
    });
  }

  return byId;
};

const skipDetectBackoffMs = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);

type SkipDetectBatchOutcome = {
  skip: LlmSkipDetectItemResult[];
  missing: LlmSkipDetectItem[];
  abandoned: boolean;
};

/**
 * Call LLM for one batch with retries/backoff. On persistent failure returns
 * `abandoned: true` (items treated as keep). On partial parse returns `missing`.
 */
const auditSkipBatchWithRetry = async (
  opts: LlmSkipDetectOptions,
  items: LlmSkipDetectItem[],
): Promise<SkipDetectBatchOutcome> => {
  const maxAttempts = CONFIG.llmMaxAttempts;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await callSkipDetectLlm(opts, items, attempt + 1);
      if (!raw.content.trim()) {
        throw new Error('LLM returned empty response');
      }

      const expectedIds = items.map((item) => item.id);
      const parsed = parseSkipItemsFromRaw(raw.content, expectedIds, raw.meta);
      const skip: LlmSkipDetectItemResult[] = [];
      const missing: LlmSkipDetectItem[] = [];

      for (const item of items) {
        const row = parsed.get(item.id);
        if (!row) {
          missing.push(item);
          continue;
        }
        if (row.verdict === 'skip') skip.push(row);
      }

      return { skip, missing, abandoned: false };
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastErr = err;
      if (attempt === maxAttempts - 1) break;
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        `Skip-detect LLM retry ${attempt + 1}/${maxAttempts}: ${message} — waiting ${Math.round(skipDetectBackoffMs(attempt))}ms`,
      );
      await new Promise((r) => setTimeout(r, skipDetectBackoffMs(attempt)));
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  log.warn('Skip-detect LLM batch abandoned after retries; treating items as keep', {
    error: message,
    itemCount: items.length,
    itemIds: items.map((item) => item.id),
  });

  return { skip: [], missing: items, abandoned: true };
};

const callSkipDetectLlm = async (
  opts: LlmSkipDetectOptions,
  items: LlmSkipDetectItem[],
  attempt = 1,
) => {
  const expectedIds = items.map((item) => item.id);
  const payload = buildSkipDetectUserPayload({ ...opts, items });
  return chatWithFallback({
    model: opts.model,
    temperature: 0,
    responseFormat: buildSkipDetectResponseFormat(expectedIds.length),
    signal: opts.signal,
    logMeta: {
      operation: 'skip_detect',
      context: {
        itemIds: expectedIds,
        itemCount: expectedIds.length,
        attempt,
        srcLang: opts.srcLang,
        modName: opts.modName ?? null,
      },
    },
    messages: [
      {
        role: 'system',
        content: buildSkipDetectSystemPrompt(opts.srcLang, opts.game),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });
};

/** Run LLM non-translatable audit on a batch; returns only skip verdicts. */
export const detectSkipCandidatesWithLlm = async (
  opts: LlmSkipDetectOptions,
): Promise<LlmSkipDetectItemResult[]> => {
  if (opts.items.length === 0) return [];

  const skipResults: LlmSkipDetectItemResult[] = [];
  let pending = opts.items;
  let missingRounds = 0;
  const maxMissingRounds = CONFIG.llmMaxAttempts;

  while (pending.length > 0) {
    const { skip, missing, abandoned } = await auditSkipBatchWithRetry(opts, pending);
    skipResults.push(...skip);

    if (abandoned) break;

    if (missing.length === 0) break;

    missingRounds++;
    if (missingRounds >= maxMissingRounds) {
      log.warn('Skip-detect unresolved after retries; treating as keep', {
        count: missing.length,
        itemIds: missing.map((item) => item.id),
      });
      break;
    }

    log.warn('Skip-detect LLM response missing some ids; retrying subset', {
      missingCount: missing.length,
      missingIds: missing.map((item) => item.id),
      round: missingRounds,
    });
    pending = missing;
  }

  return skipResults;
};
