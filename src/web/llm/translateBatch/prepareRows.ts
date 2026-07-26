import { maskFunctionKeywords, maskPlaceholders } from '../../../utils/placeholders';
import { maskLlmOptionalText } from '../../../llm/llmTextMask';
import { buildLlmParticipantPayload } from '../../../llm/dialogParticipants';
import { parseRecordLocation } from '../../../utils/recordLocation';
import { dialogParticipantsFromRow } from '../../data/queries/dialogs';
import { mergeNarratorGender } from './mergeNarratorGender';
import type { GameType } from '../../../types';
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

    const sourceText = row.text_raw;
    const game = row.game ?? opts.modGame ?? undefined;
    const { grup, field } = parseRecordLocation(row.signature, row.path);

    const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(sourceText);
    const { masked: protectedMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
      placeholderMasked,
      game as GameType | undefined,
      { grup, field },
    );
    const maskedSourceText = protectedMasked;

    const translatableContent = maskedSourceText.replace(/¤(?:PH|GL|FK)\d+¤/g, '').trim();
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
