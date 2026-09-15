import type { GameTextAdapter } from '../contract';
import { restoreDiscoCensoredSpeech } from './text/censorship';
import { restoreDiscoMarkupShape } from './text/lockitMarkup';
import { maskDiscoLockitMarkup } from './text/markupMask';
import { applyDiscoMarkupGuardToVerifyResult } from './text/verifyGuard';

/**
 * Disco Elysium text carries lockit markup the translation must mirror:
 * `*italics*`, `"speech"`, `'Titles'`, and `--` em dashes. The model is shown
 * opaque keys instead of the marks so it cannot drop or invent them, and the
 * verify pass double-checks that the counts still match.
 *
 * The shipped `.po` files also censor profanity (`f%$#ing`); TTS and the LLM
 * see the real word, and the mask is put back on export.
 */
export const discoTextAdapter: GameTextAdapter = {
  // Creation Kit function keywords do not exist in a Unity title.
  functionKeywords: [],

  /**
   * A `.po` catalogue is text and nothing else: no scripts, no settings menu,
   * no character creator. What the signatures do distinguish — spoken versus
   * not — the dialog adapter answers.
   */
  recordKind: () => 'other',
  maskMarkup: (text) => maskDiscoLockitMarkup(text),
  restoreCensoredSpeech: (text) => restoreDiscoCensoredSpeech(text),
  restoreMarkupShape: (source, translation) => restoreDiscoMarkupShape(source, translation),
  guardVerifyResult: (item, result) => applyDiscoMarkupGuardToVerifyResult(item, result),
};
