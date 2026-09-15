/**
 * Ask the model to choose between the translation a row already has and the one
 * verify wants to put there.
 *
 * Verify judges a line on its own — "is this good?" — and measured against the
 * production corpus that judgement does not reproduce: a third of the rows it
 * passes on one run it objects to on the next, and it rejects its own fresh
 * output nine times out of ten. A row therefore gets rewritten again and again
 * without ever settling.
 *
 * A comparison is a different question. The model is shown both wordings and
 * asked which renders the source better, with the current text winning ties.
 * That makes the pass self-terminating: once nothing it proposes beats what is
 * already there, the row is done and stops churning.
 *
 * Best effort. If the call fails or returns nothing usable, every candidate is
 * kept — the behaviour without this pass.
 */
import { chatWithFallback } from './index';
import { parseLlmItemId, parseLlmJson } from './jsonParse';
import { compactLlmItemFields } from './llmPayloadCompact';
import { participantPayloadFields } from './dialogParticipants';
import { buildPreferredTranslationResponseFormat } from './responseSchemas';
import { logLlm } from '../logging/loggers';
import type { GameId } from '../types';
import type { LlmVerifyItem } from './verifyTranslateTypes';

const PREFER_PROMPT = `You choose between two translations of the same source line.

Input: JSON with "items" (id, source, current, candidate, and speaker/addressee
fields when the line is dialogue).
Output: JSON only — {"items":[{"id":<number>,"choice":"current"|"candidate"}]}.
Same ids, same order. No markdown, no commentary.

Pick "candidate" only when it is clearly the better rendering of the source:
it fixes a real error, restores meaning the other one lost, or reads as the
target language where the other reads as translated English.

Pick "current" when the two are equally good, when the difference is a matter
of taste, when the candidate only reorders words or swaps a synonym, or when
the candidate drops punctuation, detail or a placeholder that the source has.
A tie is always "current": a line is not improved by being different.`;

export type PreferTranslationItem = {
  item: LlmVerifyItem;
  candidate: string;
};

export type PreferTranslationOpts = {
  model: string;
  srcLang: string;
  targetLang: string;
  game?: GameId | string | null;
  signal?: AbortSignal;
};

const buildPayload = (rows: PreferTranslationItem[], opts: PreferTranslationOpts): object => ({
  task: 'choose_better_translation',
  source_language: opts.srcLang,
  target_language: opts.targetLang,
  game: opts.game ?? null,
  items: rows.map(({ item, candidate }) => ({
    id: item.id,
    source: item.source,
    current: item.translation,
    candidate,
    ...compactLlmItemFields(item),
    ...participantPayloadFields(item),
  })),
});

const parseChoices = (raw: string): Map<number, 'current' | 'candidate'> => {
  const byId = new Map<number, 'current' | 'candidate'>();
  const parsed = parseLlmJson(raw);
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return byId;
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; choice?: unknown };
    const id = parseLlmItemId(row.id);
    if (id == null) continue;
    if (row.choice === 'current' || row.choice === 'candidate') byId.set(id, row.choice);
  }
  return byId;
};

/**
 * The ids whose candidate beat the text already in place. An id missing from
 * the answer keeps its current translation.
 */
export const preferBetterTranslations = async (
  rows: PreferTranslationItem[],
  opts: PreferTranslationOpts,
): Promise<Set<number>> => {
  const winners = new Set<number>();
  if (rows.length === 0) return winners;

  try {
    const { content } = await chatWithFallback({
      model: opts.model,
      responseFormat: buildPreferredTranslationResponseFormat(rows.length),
      ...(opts.signal ? { signal: opts.signal } : {}),
      logMeta: {
        operation: 'prefer-translation',
        context: {
          itemIds: rows.map((row) => row.item.id),
          itemCount: rows.length,
          game: opts.game ?? null,
        },
      },
      messages: [
        { role: 'system', content: PREFER_PROMPT },
        { role: 'user', content: JSON.stringify(buildPayload(rows, opts)) },
      ],
    });

    const choices = parseChoices(content);
    for (const { item } of rows) {
      if (choices.get(item.id) === 'candidate') winners.add(item.id);
    }
    return winners;
  } catch (err) {
    logLlm.warn('translation comparison failed; keeping every candidate', {
      itemCount: rows.length,
      err: err instanceof Error ? err.message : String(err),
    });
    for (const { item } of rows) winners.add(item.id);
    return winners;
  }
};
