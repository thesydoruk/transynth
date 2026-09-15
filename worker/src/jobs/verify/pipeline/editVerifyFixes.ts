/**
 * Run the game's own dialogue editor passes over a verify fix before saving it.
 *
 * Translate finishes every draft with the recast pass (rewrite the predicate so
 * the line reads for either gender) and then the gender-repair pass. A fix
 * written by verify skipped both: the auditor is asked for a minimal patch of
 * the one problem it named, so it reaches for the cheap escape — swapping
 * «ти»/«ви» or picking a gender — and the next verification rejects what this
 * one just wrote. Sending fixes through the same two passes puts them under the
 * discipline verify itself enforces.
 *
 * Best effort throughout. Both passes return the draft untouched when the game
 * has no recast or the language needs no gender guard, without calling the LLM,
 * and an edit that breaks a protected token is discarded in favour of the fix as
 * it stood.
 */
import { gamePlugin } from '../../../../../src/games/registry';
import { recastDialogTranslations } from '../../../../../src/llm/dialogRecast';
import { findGenderLeaks } from '../../../../../src/llm/genderGuard';
import { repairGenderLeaks } from '../../../../../src/llm/genderRepair';
import { buildLlmParticipantPayload } from '../../../../../src/llm/dialogParticipants';
import { validateVerifySuggestion } from '../../../../../src/llm/verifySuggestionGuards';
import { logVerify } from '../../../../../src/logging/loggers';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { dialogParticipantsFromRow } from '../../../../../src/web/data/queries/dialogs';
import { mergeNarratorGender } from '../../translate/batch/mergeNarratorGender';
import type {
  LlmTranslateItem,
  LlmTranslateOptions,
  LlmTranslateResult,
} from '../../../../../src/llm/translate';
import type { LlmVerifyItem } from '../../../../../src/llm/verifyTranslate';
import type { VerifyStringRow } from './types';

/** One fix as verify decided it, before the editor passes run. */
export type VerifyFixDraft = {
  stringId: number;
  text: string;
  row: VerifyStringRow;
};

export type EditVerifyFixesOpts = {
  model: string;
  srcLang: string;
  targetLang: string;
  game?: string | null;
  modName?: string | null;
  signal?: AbortSignal;
};

const toTranslateItem = (row: VerifyStringRow, game?: string | null): LlmTranslateItem => {
  const { grup, field } = parseRecordLocation(row.signature, row.path);
  const isDialogueLine = gamePlugin(game).dialog?.isSpokenSignature(grup) ?? false;
  const participants = mergeNarratorGender(
    dialogParticipantsFromRow(row, field, game),
    row.narrator_gender,
    isDialogueLine,
  );
  return {
    id: row.string_id,
    source: row.source,
    grup,
    edid: row.edid,
    field,
    form_id: null,
    context: row.context,
    ...buildLlmParticipantPayload(participants, { isDialogueLine }),
  };
};

const toValidationItem = (row: VerifyStringRow): LlmVerifyItem => {
  const { grup, field } = parseRecordLocation(row.signature, row.path);
  return {
    id: row.string_id,
    source: row.source,
    translation: row.translation,
    grup,
    edid: row.edid,
    field,
    context: row.context,
  };
};

/**
 * Edited text per string id, containing only the fixes an editor pass changed
 * and whose result still carries every protected token of the source.
 */
export const editVerifyFixes = async (
  fixes: VerifyFixDraft[],
  opts: EditVerifyFixesOpts,
): Promise<Map<number, string>> => {
  const edited = new Map<number, string>();
  if (fixes.length === 0) return edited;

  // Rows in one persist batch come from a single LLM chunk, so they share the
  // family and scene the chunk was built for.
  const [{ row: first }] = fixes as [VerifyFixDraft, ...VerifyFixDraft[]];
  const translateOpts: LlmTranslateOptions = {
    items: fixes.map((fix) => toTranslateItem(fix.row, opts.game)),
    model: opts.model,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    game: opts.game,
    modName: opts.modName,
    ...(first.promptFamily ? { promptFamily: first.promptFamily } : {}),
    ...(first.dialogScene ? { dialogScene: first.dialogScene } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  const draft: LlmTranslateResult[] = fixes.map((fix) => ({
    id: fix.stringId,
    translation: fix.text,
  }));

  let editedDraft: LlmTranslateResult[];
  try {
    const recast = await recastDialogTranslations(translateOpts, draft);
    editedDraft = await repairGenderLeaks(translateOpts, recast);
  } catch (err) {
    logVerify.warn('verify fix editor pass failed; keeping fixes as verify wrote them', {
      stringIds: fixes.map((fix) => fix.stringId),
      error: err instanceof Error ? err.message : String(err),
    });
    return edited;
  }

  const fixById = new Map(fixes.map((fix) => [fix.stringId, fix]));
  for (const result of editedDraft) {
    const fix = fixById.get(result.id);
    if (!fix) continue;
    const text = result.translation.trim();
    if (!text || text === fix.text) continue;

    const check = validateVerifySuggestion(toValidationItem(fix.row), text, opts.game);
    if (!check.ok) {
      // 'noop' here means the editor walked the fix back to the text verify had
      // just rejected; every other reason is a broken suggestion.
      logVerify.warn('verify fix editor result rejected; keeping the fix', {
        stringId: result.id,
        reason: check.reason,
        message: check.message,
      });
      continue;
    }
    edited.set(result.id, text);
  }

  return edited;
};

/**
 * Last resort for a line the auditor proved wrong about gender but offered no
 * wording for.
 *
 * Measured on mod 33: of the rows left blocked after the gate change, 57 of 84
 * were in exactly this position — the model named the problem ("marked gender
 * with speaker_gender: any, an impersonal rephrase is needed") and returned no
 * suggestion, so there was nothing to apply, nothing to compare, and the row
 * could be neither repaired nor approved. Ukrainian past-tense and predicative
 * forms are the hard case here, and there is already a pass built for it, which
 * names the offending forms and asks for that one line back.
 *
 * The line as it stands is handed to that pass. Only the gender pass runs: a
 * broad recast would rewrite more than the proven defect. A result is taken
 * only when it keeps every protected token and the leak is actually gone —
 * otherwise the row stays blocked, which is the honest outcome.
 */
export const repairProvenGenderLeaks = async (
  rows: VerifyStringRow[],
  opts: EditVerifyFixesOpts,
): Promise<Map<number, string>> => {
  const repaired = new Map<number, string>();
  if (rows.length === 0) return repaired;

  const items = rows.map((row) => toTranslateItem(row, opts.game));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const translateOpts: LlmTranslateOptions = {
    items,
    model: opts.model,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    game: opts.game,
    modName: opts.modName,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  let result: LlmTranslateResult[];
  try {
    result = await repairGenderLeaks(
      translateOpts,
      rows.map((row) => ({ id: row.string_id, translation: row.translation })),
    );
  } catch (err) {
    logVerify.warn('gender repair of blocked rows failed', {
      stringIds: rows.map((row) => row.string_id),
      error: err instanceof Error ? err.message : String(err),
    });
    return repaired;
  }

  const rowById = new Map(rows.map((row) => [row.string_id, row]));
  for (const row of result) {
    const source = rowById.get(row.id);
    const item = itemById.get(row.id);
    if (!source || !item) continue;
    const text = row.translation.trim();
    if (!text || text === source.translation.trim()) continue;

    const check = validateVerifySuggestion(toValidationItem(source), text, opts.game);
    if (!check.ok) continue;
    if (findGenderLeaks(text, item, opts.targetLang).length > 0) continue;

    repaired.set(row.id, text);
  }

  return repaired;
};
