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
    '- Note: the declared source_language is not always accurate — some rows may already be partly localized. Judge by the actual content, not by the declared language.',
    '',
    '### VERDICT:',
    '- "skip": do not translate — leave source as-is in the game files.',
    '- "keep": normal translatable player-facing text.',
    '',
    '### SKIP WHEN (the row has no human-readable words once markup is removed):',
    '- Markup/variable only: e.g. "<Alias.CurrentName=Location384>", "<Token.Name=SettlementName>", "<img src=\'…\'>", "<font face=\'…\'>42</font>", "<Alias=QuestVerb> <Alias=myLocation>".',
    '- Numbers, dates, stats or symbols only: e.g. "+15%", "10/22/2077", "->", "№3", "=====", "....".',
    '- FormID-like hex, hex/byte dumps, file or property paths, debug labels.',
    "- Editor IDs copied into text (source equals the row's edid).",
    '- Single-letter codes and short locale-independent stat abbreviations (e.g. "AGI", "AP", "CHR" in AVIF/SPECIAL contexts).',
    '',
    '### KEEP WHEN (there is real wording to translate, even if wrapped):',
    '- Player-visible UI, dialogue, item names, descriptions, books, notes, quest text.',
    '- Bracketed stage directions / tone tags ARE player-facing: "[Sarcasm]", "[Whispering]", "[Impatiently]" → keep.',
    '- Prose that merely contains angle brackets: "<User \\"Bergman\\" signed in>", "<***Using ICE-Breaker***>" → keep (the words inside are real text).',
    '- A string mixing markup with words ("Help defend <Alias=myLocation>") → keep.',
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
    '- Увага: задана source_language не завжди точна — частина рядків може бути вже частково локалізована. Оцінюй за реальним вмістом, а не за заявленою мовою.',
    '',
    '### VERDICT:',
    '- "skip": не перекладати — залишити source як є.',
    '- "keep": звичайний текст для гравця, потребує перекладу.',
    '',
    '### SKIP КОЛИ (після прибирання розмітки не лишається читабельних слів):',
    '- Лише розмітка/змінні: напр. "<Alias.CurrentName=Location384>", "<Token.Name=SettlementName>", "<img src=\'…\'>", "<font face=\'…\'>42</font>", "<Alias=QuestVerb> <Alias=myLocation>".',
    '- Лише числа, дати, стати чи символи: "+15%", "10/22/2077", "->", "№3", "=====", "....".',
    '- FormID/hex-дампи, шляхи до файлів чи властивостей, debug-мітки.',
    '- EDID, скопійований у текст (source дорівнює edid рядка).',
    '- Однолітерні коди та короткі мовно-незалежні абревіатури статів (напр. "AGI", "AP", "CHR" у контексті AVIF/SPECIAL).',
    '',
    '### KEEP КОЛИ (є реальні слова для перекладу, навіть якщо вони в обгортці):',
    '- UI, діалоги, назви предметів, описи, книги, нотатки, квестовий текст.',
    '- Ремарки/тон у квадратних дужках — це текст для гравця: "[Sarcasm]", "[Шепоче]", "[Нетерпляче]" → keep.',
    '- Проза, що просто містить кутові дужки: "<User \\"Bergman\\" signed in>", "<***Використання ICE-Breaker***>" → keep (всередині справжній текст).',
    '- Рядок, що поєднує розмітку зі словами ("Help defend <Alias=myLocation>") → keep.',
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
