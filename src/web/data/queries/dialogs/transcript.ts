import type { Tx } from '../../../../db';
import { CONFIG } from '../../../../config';
import type { DialogScope, DialogTranscriptRow } from './scope';
import { getTopicTranscript } from './topicTranscript';
import { getConversationTranscript, getSceneTranscript } from './sceneTranscript';

/**
 * Load the dialog content of one group, whatever its scope.
 *
 * Returns `null` when the key does not resolve to a group of this mod, which
 * the route turns into a 404 — the browser can hold a stale deep link.
 *
 * @param db - Database handle.
 * @param modId - Mod that must own the group.
 * @param scope - Kind of group the key belongs to.
 * @param key - Topic id, scene id, or conversation key.
 * @param srcLang - Source language of the resolved strings.
 * @param targetLang - Target language of the joined translations.
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

  return scope === 'topics'
    ? getTopicTranscript(db, modId, numericKey, srcLang, targetLang)
    : getSceneTranscript(db, modId, numericKey, srcLang, targetLang);
};
