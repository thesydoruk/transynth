import type { GameTextAdapter } from '../contract';

/**
 * Elder Speech, as the subtitles spell it: `{Vatt'ghern?} [A witcher?]`. The
 * braces hold words in the game's invented language, followed by the gloss in
 * brackets. The official Remastered Ukrainian keeps the braces in 477 of the
 * 515 lines that have them and translates only the gloss, so the braced words
 * reach the model as one opaque slot.
 */
const ELDER_SPEECH_RE = /\{[^{}\n]*\}/g;

/**
 * Witcher 3 text on top of the shared masking.
 *
 * Its other markup — `<br>`, `<font …>`, `<<Examine>>` key prompts, `$I$`
 * variables — has generic shapes the shared placeholder pass already turns into
 * slots (measured on the Remastered `en` table). There is no censorship to
 * undo, and the string tables carry no record types for shared checks to tell
 * apart.
 */
export const witcher3TextAdapter: GameTextAdapter = {
  functionKeywords: [],
  recordKind: () => 'other',
  maskMarkup: (text) => {
    const mapping: Record<string, string> = {};
    let index = 0;
    const masked = text.replace(ELDER_SPEECH_RE, (speech) => {
      const key = `¤EM${index++}¤`;
      mapping[key] = speech;
      return key;
    });
    return { masked, mapping };
  },
  restoreCensoredSpeech: (text) => text,
  restoreMarkupShape: (_source, translation) => translation,
  guardVerifyResult: (_item, result) => result,
};
