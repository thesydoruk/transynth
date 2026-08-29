/**
 * Group per-file voice synthesis warnings for logs.
 *
 * A mod-wide job can fail on thousands of lines for the same reason (TTS
 * timeout, missing reference audio, …). Each message names its own file, so
 * grouping needs the file, cache path and FormID tokens removed first.
 */

/** Leading `Sound/Voice/…/0002CBA_1.fuz: ` part of a per-entry warning. */
const ENTRY_PREFIX_RE = /^\S*?\.(?:fuz|wav|xwm):\s*/i;
const PATH_RE = /(?:[A-Za-z]:)?[\\/][^\s"']*[\\/][^\s"']*/g;
const VOICE_ID_RE = /\b[0-9A-Fa-f]{6,8}_\d+\b/g;
const LONG_NUMBER_RE = /\b\d{3,}\b/g;

export type VoiceWarningGroup = {
  /** Warning text with file-specific tokens replaced by placeholders. */
  reason: string;
  count: number;
  /** First original message in the group, kept for context. */
  example: string;
};

const normalizeWarning = (message: string): string =>
  message
    .replace(ENTRY_PREFIX_RE, '')
    .replace(PATH_RE, '<path>')
    .replace(VOICE_ID_RE, '<id>')
    .replace(LONG_NUMBER_RE, '<n>')
    .trim() || message.trim();

/** Most frequent warning reasons first. */
export const summarizeVoiceWarnings = (
  messages: readonly string[],
  limit = 10,
): VoiceWarningGroup[] => {
  const groups = new Map<string, VoiceWarningGroup>();

  for (const message of messages) {
    const reason = normalizeWarning(message);
    const group = groups.get(reason);
    if (group) group.count += 1;
    else groups.set(reason, { reason, count: 1, example: message });
  }

  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
};
