/**
 * Full-mismatch verify fix — re-translate source only (wrong long translation attached).
 */
import type { GameType } from '../types';
import { normalizeAutoTranslationDashes } from '../utils/textNorm';
import { maskFunctionKeywords, maskPlaceholders, unmask } from '../utils/placeholders';
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
  game?: GameType | string | null;
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

  const maskedById = new Map<
    number,
    {
      masked: string;
      placeholderMap: Record<string, string>;
      functionKeywordMap: Record<string, string>;
    }
  >();

  for (const item of opts.items) {
    const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(item.source);
    const { masked, mapping: functionKeywordMap } = maskFunctionKeywords(
      placeholderMasked,
      opts.game as GameType | undefined,
      { grup: item.grup, field: item.field },
    );
    maskedById.set(item.id, { masked, placeholderMap, functionKeywordMap });
  }

  const translations = await translateStrings({
    items: opts.items.map((item) => ({
      id: item.id,
      source: maskedById.get(item.id)!.masked,
      grup: item.grup,
      edid: item.edid,
      field: item.field,
      form_id: null,
      context: null,
    })),
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
    const masks = maskedById.get(row.id);
    if (!item || !masks) continue;

    const text = normalizeAutoTranslationDashes(
      unmask(unmask(row.translation, masks.functionKeywordMap), masks.placeholderMap),
    );
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
