/**
 * Stable Disco `.po` record path keys that stay under PostgreSQL btree limits.
 *
 * `records` unique index includes `path`; PG btree rejects index rows > 2704 bytes.
 * Long gettext msgids (numeric dumps, long dialogue) are stored as `msgctxt::#sha1`.
 */
import { createHash } from 'node:crypto';
import { poEntryKey } from '../../formats/po';

/** Leave headroom under the 2704-byte btree index row limit. */
export const DISCO_PO_PATH_MAX_BYTES = 2400;

const HASHED_MSGID_RE = /^#([a-f0-9]{40})$/i;

/** SHA-1 hex of msgid (utf8), used when the full path would be too long. */
export const hashDiscoMsgid = (msgid: string): string =>
  createHash('sha1').update(msgid, 'utf8').digest('hex');

/** True when `entryKey` uses the hashed-msgid form `msgctxt::#sha1`. */
export const isHashedDiscoEntryKey = (entryKey: string): boolean => {
  const sep = entryKey.indexOf('::');
  const msgidPart = sep >= 0 ? entryKey.slice(sep + 2) : entryKey;
  return HASHED_MSGID_RE.test(msgidPart);
};

/**
 * Storage key for one `.po` entry inside a language folder.
 * Prefers `msgctxt::msgid`; switches to `msgctxt::#sha1(msgid)` when needed.
 */
export const discoPoEntryStorageKey = (relPo: string, msgctxt: string, msgid: string): string => {
  const fullKey = poEntryKey(msgctxt, msgid);
  const fullPath = `PO\\${relPo}\\${fullKey}`;
  if (Buffer.byteLength(fullPath, 'utf8') <= DISCO_PO_PATH_MAX_BYTES) return fullKey;
  return poEntryKey(msgctxt, `#${hashDiscoMsgid(msgid)}`);
};

/** Full `records.path` for a Disco PO entry. */
export const discoPoRecordPath = (relPo: string, msgctxt: string, msgid: string): string =>
  `PO\\${relPo}\\${discoPoEntryStorageKey(relPo, msgctxt, msgid)}`;
