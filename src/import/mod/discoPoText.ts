/**
 * Locale text from Disco Translator Final Cut `.po` entries.
 *
 * Dialogue dumps keep English in `msgid`. Effects / passive-check lockits use
 * dummy `msgid "N/A"` and put the real string in `msgstr`.
 */
import type { PoEntry } from '../../formats/po';

/** True when msgid is a Disco Translator dummy, not real source text. */
export const isDiscoPlaceholderMsgid = (msgid: string): boolean => {
  const t = msgid.trim();
  return t.length === 0 || /^n\/a$/i.test(t);
};

/**
 * Text carried by this locale file.
 * Prefer non-empty msgstr (the language of the folder); fall back to msgid
 * unless msgid is a placeholder.
 */
export const discoPoLocaleText = (entry: PoEntry): string => {
  if (entry.msgstr.trim()) return entry.msgstr;
  if (isDiscoPlaceholderMsgid(entry.msgid)) return entry.msgstr;
  return entry.msgid;
};
