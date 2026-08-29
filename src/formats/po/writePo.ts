/**
 * Compile gettext `.po` files, optionally overlaying msgstr values by entry key.
 */
import * as gettextParser from 'gettext-parser';
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser';
import { poEntryKey } from './parsePo';

export type WritePoOptions = {
  /** When set, replace msgstr for matching `msgctxt::msgid` keys. */
  overlays?: Map<string, string>;
  /** Charset written into headers (default utf-8). */
  charset?: string;
};

/**
 * Parse source `.po`, apply msgstr overlays, and compile back to a Buffer.
 * Entries without overlays keep their original msgstr.
 */
export const writePoWithOverlays = (
  sourceBuf: Buffer | string,
  overlays: Map<string, string>,
): Buffer => {
  const parsed = gettextParser.po.parse(sourceBuf) as GetTextTranslations;
  for (const [msgctxt, byMsgid] of Object.entries(parsed.translations ?? {})) {
    for (const [msgid, item] of Object.entries(byMsgid as Record<string, GetTextTranslation>)) {
      if (msgctxt === '' && msgid === '') continue;
      const key = poEntryKey(msgctxt, msgid);
      const next = overlays.get(key);
      if (next == null) continue;
      item.msgstr = [next];
    }
  }
  return gettextParser.po.compile(parsed);
};

/** Compile a minimal `.po` from msgid→msgstr pairs (no msgctxt). */
export const writePoFromMap = (entries: Map<string, string>, charset = 'utf-8'): Buffer => {
  const translations: GetTextTranslations['translations'] = {
    '': {
      '': {
        msgid: '',
        msgstr: [`Content-Type: text/plain; charset=${charset}\n`],
      },
    },
  };

  for (const [msgid, msgstr] of entries) {
    if (!msgid) continue;
    translations['']![msgid] = { msgid, msgstr: [msgstr] };
  }

  const data: GetTextTranslations = {
    charset,
    headers: {
      'content-type': `text/plain; charset=${charset}`,
    },
    translations,
  };
  return gettextParser.po.compile(data);
};
