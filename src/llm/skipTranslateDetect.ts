/**
 * LLM audit — flags source strings that should not be translated.
 */
import { chatWithFallback } from './index';
import { isUkrainianTargetLang } from './translate';
import type { GameType } from '../types';
import { parseVerifyItemId } from './verifyTranslate';

export type LlmSkipDetectVerdict = 'skip' | 'keep';

export interface LlmSkipDetectItem {
  id: number;
  source: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
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
  targetLang: string;
  game?: GameType | string | null;
  modName?: string | null;
}

const VALID_VERDICTS = new Set<LlmSkipDetectVerdict>(['skip', 'keep']);

const buildEnglishSkipDetectSystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  const title = game ? `${game} / Bethesda` : 'Bethesda';

  return [
    `You are an expert ${title} localization engineer auditing which source strings (${srcLang}) should NOT be translated into ${targetLang}.`,
    'Your task: identify rows that must remain unchanged in the localized plugin (technical tokens, internal IDs, format markers, untranslatable codes, duplicate variable names, etc.).',
    '',
    '### TECHNICAL REQUIREMENTS:',
    '- Input: JSON with metadata and an "items" array (id, source, grup, field, edid, context).',
    '- Output: valid JSON ONLY. No markdown fences.',
    '- Return one object per input id.',
    '',
    '### VERDICT:',
    '- "skip": do not translate — leave source as-is in the game files.',
    '- "keep": normal translatable player-facing text.',
    '',
    '### SKIP WHEN:',
    '- Placeholder-only, numeric/stat-only, FormID-like hex, editor IDs copied as text.',
    '- Internal script markers, property paths, file paths, debug labels.',
    '- Single-letter codes, keyboard hints that are locale-independent symbols.',
    '- Proper nouns that must stay in source language per series convention ONLY when clearly technical (not normal item names).',
    '',
    '### KEEP WHEN:',
    '- Player-visible UI, dialogue, item names, descriptions, books, quest text.',
    '- When uncertain, prefer "keep".',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":1,"verdict":"skip","reason":"…","confidence":0.95},{"id":2,"verdict":"keep","reason":"…","confidence":0.9}]}',
  ].join('\n');
};

const buildUkrainianSkipDetectSystemPrompt = (
  srcLang: string,
  game?: GameType | string | null,
): string => {
  const title = game ? `${game} / Bethesda` : 'Bethesda';

  return [
    `Ти — експерт з локалізації ігор ${title}, який визначає, які рядки (${srcLang}) НЕ потрібно перекладати українською.`,
    'Завдання: знайти рядки, які мають залишитися без перекладу (технічні токени, внутрішні ID, форматні маркери, коди, дублікати змінних тощо).',
    '',
    '### ТЕХНІЧНІ ВИМОГИ:',
    '- Вхід: JSON з масивом "items" (id, source, grup, field, edid, context).',
    '- Вихід: лише валідний JSON, без markdown.',
    '- Для кожного id — один об’єкт у відповіді.',
    '',
    '### VERDICT:',
    '- "skip": не перекладати — залишити source як є.',
    '- "keep": звичайний текст для гравця, потребує перекладу.',
    '',
    '### SKIP КОЛИ:',
    '- Лише плейсхолдери, числа/стати, FormID, EDID як текст, шляхи, debug-мітки.',
    '- Однолітерні коди, символи клавіш, які не локалізуються.',
    '',
    '### KEEP КОЛИ:',
    '- UI, діалоги, назви предметів, описи, книги, квестовий текст.',
    '- Якщо сумніваєшся — "keep".',
    '',
    '### ФОРМАТ ВІДПОВІДІ:',
    '{"items":[{"id":1,"verdict":"skip","reason":"…","confidence":0.95}]}',
  ].join('\n');
};

export const buildSkipDetectSystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  if (isUkrainianTargetLang(targetLang)) {
    return buildUkrainianSkipDetectSystemPrompt(srcLang, game);
  }
  return buildEnglishSkipDetectSystemPrompt(srcLang, targetLang, game);
};

export const buildSkipDetectUserPayload = (opts: Omit<LlmSkipDetectOptions, 'model'>): object => ({
  task: 'non_translatable_audit',
  source_language: opts.srcLang.trim().toLowerCase(),
  target_language: opts.targetLang.trim().toLowerCase(),
  game: opts.game ?? null,
  mod_name: opts.modName ?? null,
  items: opts.items.map((item) => ({
    id: item.id,
    source: item.source,
    grup: item.grup,
    edid: item.edid,
    field: item.field,
    context: item.context,
  })),
});

const stripJsonFence = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
};

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

const parseSkipItemsFromRaw = (raw: string): Map<number, LlmSkipDetectItemResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    throw new Error('LLM skip-detect response is not valid JSON');
  }

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

const SKIP_DETECT_MAX_ATTEMPTS = 3;

const callSkipDetectLlm = async (
  opts: LlmSkipDetectOptions,
  items: LlmSkipDetectItem[],
): Promise<string> => {
  const expectedIds = items.map((item) => item.id);
  const payload = buildSkipDetectUserPayload({ ...opts, items });
  return chatWithFallback({
    model: opts.model,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    logMeta: {
      operation: 'skip_detect',
      context: {
        itemIds: expectedIds,
        itemCount: expectedIds.length,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        modName: opts.modName ?? null,
      },
    },
    messages: [
      {
        role: 'system',
        content: buildSkipDetectSystemPrompt(opts.srcLang, opts.targetLang, opts.game),
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

  for (let attempt = 0; attempt < SKIP_DETECT_MAX_ATTEMPTS && pending.length > 0; attempt++) {
    const raw = await callSkipDetectLlm(opts, pending);
    const parsed = parseSkipItemsFromRaw(raw);

    const missing: LlmSkipDetectItem[] = [];
    for (const item of pending) {
      const row = parsed.get(item.id);
      if (!row) {
        missing.push(item);
        continue;
      }
      if (row.verdict === 'skip') skipResults.push(row);
    }

    if (missing.length === 0) break;
    if (attempt === SKIP_DETECT_MAX_ATTEMPTS - 1) {
      throw new Error(`LLM skip-detect response missing item id=${missing[0].id}`);
    }
    pending = missing;
  }

  return skipResults;
};
