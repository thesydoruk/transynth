/**
 * Parse gettext `.po` buffers into flat translation entries.
 */
import * as gettextParser from 'gettext-parser';
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser';

/** One translatable unit from a `.po` file (header entry excluded). */
export type PoEntry = {
  /** msgctxt, empty string when absent */
  msgctxt: string;
  msgid: string;
  msgstr: string;
  /** Stable key: `msgctxt::msgid` or `::msgid` when no context */
  key: string;
};

/** Build the stable entry key used in DB paths and overlays. */
export const poEntryKey = (msgctxt: string, msgid: string): string => `${msgctxt}::${msgid}`;

/** True when this is the PO file header (empty msgid in default context). */
const isHeaderEntry = (msgctxt: string, msgid: string): boolean => msgctxt === '' && msgid === '';

const msgstrOf = (item: GetTextTranslation): string => {
  const msgstrArr = item.msgstr;
  return Array.isArray(msgstrArr) ? (msgstrArr[0] ?? '') : String(msgstrArr ?? '');
};

/**
 * Parse a `.po` file buffer into entries.
 * Skips the gettext header block.
 */
export const parsePoBuffer = (buf: Buffer | string): PoEntry[] => {
  const parsed = gettextParser.po.parse(buf) as GetTextTranslations;
  const entries: PoEntry[] = [];

  for (const [msgctxt, byMsgid] of Object.entries(parsed.translations ?? {})) {
    for (const [msgid, item] of Object.entries(byMsgid as Record<string, GetTextTranslation>)) {
      if (isHeaderEntry(msgctxt, msgid)) continue;
      if (!msgid) continue;
      entries.push({
        msgctxt,
        msgid,
        msgstr: msgstrOf(item),
        key: poEntryKey(msgctxt, msgid),
      });
    }
  }

  return entries;
};

/** Parse a UTF-8 `.po` string. */
export const parsePoString = (text: string): PoEntry[] => parsePoBuffer(text);
