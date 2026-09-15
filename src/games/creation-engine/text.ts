import type { GameRecordKind, GameTextAdapter } from '../contract';
import {
  normalizeAutoTranslationDashes,
  normalizeAutoTranslationQuotes,
} from '../../utils/textNorm';
import type { CreationEngineTitle } from './title';

/**
 * Creation Engine strings carry no markup of their own.
 *
 * Everything the LLM must not touch in a Bethesda string is a placeholder
 * (`%s`, `<Alias=…>`) or a legacy function keyword, and both are handled by
 * the shared masker. So this adapter only supplies the keyword corpus and
 * leaves the text alone.
 */
/** Subrecords of a RACE record that name a face-morph slider, not a thing. */
const FACE_MORPH_FIELDS = new Set(['FMRN', 'MPPN', 'TTGP']);

/** Records whose text is narration rather than something a character says. */
const PROSE_GRUPS = new Set(['TERM', 'BOOK', 'NOTE']);

/**
 * Record vocabulary shared by every Creation Engine title.
 *
 * A terminal is a terminal in Morrowind and in Fallout 76, so this is one
 * function for all eight rather than a per-title table.
 */
const creationEngineRecordKind = (
  grup: string | null | undefined,
  field?: string | null,
): GameRecordKind => {
  const g = (grup ?? '').trim().toUpperCase();
  const f = (field ?? '').trim().toUpperCase();

  if (g === 'SCPT' || f === 'SCTX') return 'script_source';
  if (g === 'PEX') return 'compiled_script';
  if (g === 'MCM') return 'settings_menu';
  if (g === 'RACE' && FACE_MORPH_FIELDS.has(f)) return 'face_morph';
  if (g === 'NPC_') return 'actor_name';
  if (PROSE_GRUPS.has(g)) return 'prose';
  return 'other';
};

export const createCreationEngineTextAdapter = (title: CreationEngineTitle): GameTextAdapter => ({
  functionKeywords: title.functionKeywords,
  recordKind: creationEngineRecordKind,
  maskMarkup: (text) => ({ masked: text, mapping: {} }),
  restoreCensoredSpeech: (text) => text,
  /**
   * No markup to restore — but a model answering in Ukrainian reaches for «»
   * and an em dash, and the Bethesda font atlas has neither. Folding both to
   * ASCII is unconditional here: nothing in a Creation Engine string gives a
   * typographic dash a meaning worth keeping.
   */
  restoreMarkupShape: (_source, translation) =>
    normalizeAutoTranslationDashes(normalizeAutoTranslationQuotes(translation)),
  guardVerifyResult: (_item, result) => result,
});
