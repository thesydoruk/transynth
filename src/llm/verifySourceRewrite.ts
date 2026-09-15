/**
 * Full-mismatch verify fix — re-translate source only (wrong long translation attached).
 */
import type { GameId } from '../types';
import { normalizeAutoTranslation } from '../utils/textNorm';
import { unmask } from '../utils/placeholders';
import { applyTranslateSplit, isMaskedLlmText, splitTranslateSource } from './textParts';
import { translateStrings } from './translate';
import type { LlmVerifyItem } from './verifyTranslate';
import {
  isRewriteUnchangedConfirmation,
  validateRewrittenTranslation,
} from './verifySuggestionGuards';
import { logVerify } from '../logging/loggers';

export type VerifySourceRewriteOpts = {
  items: LlmVerifyItem[];
  model: string;
  srcLang: string;
  targetLang: string;
  game?: GameId | string | null;
  modName?: string | null;
  signal?: AbortSignal;
};

export type VerifySourceRewriteResult = {
  id: number;
  text: string;
};

export type VerifySourceRewriteOutcome = {
  rewritten: VerifySourceRewriteResult[];
  confirmedUnchanged: number[];
};

export const rewriteVerifyTranslationsFromSource = async (
  opts: VerifySourceRewriteOpts,
): Promise<VerifySourceRewriteOutcome> => {
  if (opts.items.length === 0) return { rewritten: [], confirmedUnchanged: [] };

  const splitById = new Map(
    opts.items.map((item) => [
      item.id,
      splitTranslateSource(item.source, opts.game, { grup: item.grup, field: item.field }),
    ]),
  );

  const translations = await translateStrings({
    items: opts.items.map((item) =>
      applyTranslateSplit(
        {
          id: item.id,
          source: '',
          grup: item.grup,
          edid: item.edid,
          field: item.field,
          form_id: null,
          // The verify item carries the speaker/addressee context. Dropping it here
          // left the re-translation blind to who is speaking, which is exactly what
          // decides Ukrainian gender agreement.
          context: item.context ?? null,
        },
        splitById.get(item.id)!,
      ),
    ),
    model: opts.model,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    game: opts.game,
    modName: opts.modName,
    signal: opts.signal,
  });

  const rewritten: VerifySourceRewriteResult[] = [];
  const confirmedUnchanged: number[] = [];
  for (const row of translations) {
    const item = opts.items.find((entry) => entry.id === row.id);
    const split = splitById.get(row.id);
    if (!item || !split) continue;

    const assembled = isMaskedLlmText(row.translation)
      ? unmask(unmask(row.translation, split.functionKeywordMap), split.placeholderMap)
      : row.translation;
    const text = normalizeAutoTranslation(item.source, assembled, opts.game);
    const check = validateRewrittenTranslation(item, text, opts.game);
    if (!check.ok) {
      if (isRewriteUnchangedConfirmation(check)) {
        confirmedUnchanged.push(row.id);
        logVerify.info('verify source rewrite confirmed existing translation', {
          stringId: row.id,
        });
        continue;
      }
      logVerify.warn('verify source rewrite rejected translation', {
        stringId: row.id,
        reason: check.reason,
        message: check.message,
      });
      continue;
    }
    rewritten.push({ id: row.id, text });
  }

  return { rewritten, confirmedUnchanged };
};
