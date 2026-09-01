import { restoreDiscoCensoredSpeech } from '../../../../../src/formats/po/discoCensorship';
import { MASK_KEY_RE } from '../../../../../src/utils/placeholders';
import { maskLlmOptionalText, maskTranslateSource } from '../../../../../src/llm/llmTextMask';
import { buildLlmParticipantPayload } from '../../../../../src/llm/dialogParticipants';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { dialogParticipantsFromRow } from '../../../../../src/web/data/queries/dialogs';
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

    const {
      masked: maskedSourceText,
      placeholderMap,
      functionKeywordMap,
    } = maskTranslateSource(sourceText, game, { grup, field });

    const translatableContent = maskedSourceText
      .replace(new RegExp(MASK_KEY_RE.source, 'g'), '')
      .trim();
    if (!translatableContent) {
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
      placeholderMap,
      functionKeywordMap,
      game: row.game ?? opts.modGame ?? null,
      modName: row.mod_name ?? opts.modName ?? null,
      llmItem: {
        id: stringId,
        source: maskedSourceText,
        grup,
        edid: row.edid,
        field,
        form_id: row.formid_hex,
        context: maskLlmOptionalText(row.context),
        ...buildLlmParticipantPayload(participants),
      },
    });
  }

  return { llmPending, immediateResults };
};
