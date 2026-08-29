import type { Tx } from '../../../../db';
import { CONFIG } from '../../../../config';
import type { DialogScope, DialogTranscriptRow } from './scope';
import { getTopicTranscript } from './topicTranscript';
import { getBranchTranscript } from './branchTranscript';
import { getConversationTranscript, getSceneTranscript } from './sceneTranscript';

/**
 * Load the dialog content of one group, whatever its scope.
 *
 * Returns `null` when the key does not resolve to a group of this mod, which
 * the route turns into a 404 — the browser can hold a stale deep link.
 */
export const getDialogTranscript = async (
  db: Tx,
  modId: number,
  scope: DialogScope,
  key: string,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<DialogTranscriptRow | null> => {
  if (scope === 'conversations') {
    return getConversationTranscript(db, modId, key, srcLang, targetLang);
  }

  const numericKey = Number(key);
  if (!Number.isInteger(numericKey) || numericKey < 1) return null;

  if (scope === 'topics') return getTopicTranscript(db, modId, numericKey, srcLang, targetLang);
  if (scope === 'branches') return getBranchTranscript(db, modId, numericKey, srcLang, targetLang);
  return getSceneTranscript(db, modId, numericKey, srcLang, targetLang);
};
