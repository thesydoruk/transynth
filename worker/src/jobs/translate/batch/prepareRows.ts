import { restoreDiscoCensoredSpeech } from '../../../../../src/formats/po/discoCensorship';
import { maskLlmOptionalText } from '../../../../../src/llm/llmTextMask';
import {
  applyTranslateSplit,
  hasTranslatableParts,
  splitTranslateSource,
} from '../../../../../src/llm/textParts';
import { buildLlmParticipantPayload } from '../../../../../src/llm/dialogParticipants';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { dialogParticipantsFromRow } from '../../../../../src/web/data/queries/dialogs';
import { mcmKeyFromRecordPath, resolveMcmLlmContext } from '../../../../../src/formats/mcm';
import { mergeNarratorGender } from './mergeNarratorGender';
import type { PreparedLlmItem, StringRow, TranslateBatchOptions } from './types';

export const prepareLlmItems = (
  eligibleIds: number[],
  rowById: Map<number, StringRow>,
  opts: Pick<TranslateBatchOptions, 'modGame' | 'modName' | 'shouldCancel'>,
  emitResult: (r: import('./types').TranslateBatchResult) => void,
): {
  llmPending: PreparedLlmItem[];
  immediateResults: Array<{ stringId: number; text: string }>;
} => {
  const llmPending: PreparedLlmItem[] = [];
  const immediateResults: Array<{ stringId: number; text: string }> = [];

  for (const stringId of eligibleIds) {
    if (opts.shouldCancel?.()) break;

    const row = rowById.get(stringId);
    if (!row) {
      emitResult({ stringId, error: 'not found' });
      continue;
    }

    const sourceText = restoreDiscoCensoredSpeech(row.text_raw);
    const game = row.game ?? opts.modGame ?? undefined;
    const { grup, field } = parseRecordLocation(row.signature, row.path);

    const split = splitTranslateSource(sourceText, game, { grup, field });
    if (!hasTranslatableParts(split.parts)) {
      immediateResults.push({ stringId, text: sourceText });
      continue;
    }

    const participants = mergeNarratorGender(
      dialogParticipantsFromRow(row, field),
      row.narrator_gender,
      grup,
    );
    llmPending.push({
      stringId,
      sourceText,
      textNorm: row.text_norm,
      textNormNopunct: row.text_norm_nopunct,
      grup,
      field,
      recordPath: row.path,
      placeholderMap: split.placeholderMap,
      functionKeywordMap: split.functionKeywordMap,
      game: row.game ?? opts.modGame ?? null,
      modName: row.mod_name ?? opts.modName ?? null,
      llmItem: applyTranslateSplit(
        {
          id: stringId,
          source: '',
          grup,
          edid: row.edid,
          field,
          form_id: row.formid_hex,
          context: maskLlmOptionalText(row.context),
          ...buildLlmParticipantPayload(participants),
        },
        split,
      ),
    });
  }

  return { llmPending, immediateResults };
};

/** Fill empty MCM context from sibling `$key` / `$key_help` source texts. */
export const attachMcmTranslateContext = (
  items: PreparedLlmItem[],
  siblingTexts: Map<string, string>,
): void => {
  if (siblingTexts.size === 0) return;
  for (const item of items) {
    if (item.grup !== 'MCM') continue;
    const key = item.field ?? mcmKeyFromRecordPath(item.recordPath);
    const next = resolveMcmLlmContext(item.llmItem.context, key, siblingTexts);
    if (next && next !== item.llmItem.context) {
      item.llmItem.context = maskLlmOptionalText(next);
    }
  }
};
