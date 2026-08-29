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

/** Parse `PO\relPo\msgctxt::…` into file + msgctxt. */
export const parseDiscoPoPathForSignature = (
  recordPath: string,
): { relPo: string; msgctxt: string } | null => {
  if (!recordPath.toUpperCase().startsWith('PO\\') && !recordPath.toUpperCase().startsWith('PO/')) {
    return null;
  }
  const rest = recordPath.slice(3);
  const sep = rest.indexOf('\\');
  if (sep < 0) return null;
  const relPo = rest.slice(0, sep).replace(/\\/g, '/');
  const entryKey = rest.slice(sep + 1);
  const ctxSep = entryKey.indexOf('::');
  const msgctxt = ctxSep >= 0 ? entryKey.slice(0, ctxSep) : entryKey;
  return { relPo, msgctxt };
};

const DIALOGUE_MSGCTXT_RE = /^(Dialogue Text|Alternate(\d+))\/(0x[0-9A-Fa-f]+)$/i;

/** Spoken lockit field + Articy id (`Dialogue Text/0x…`, `Alternate1/0x…`). */
export const parseDiscoDialogueMsgctxt = (
  msgctxt: string,
): { field: string; articyId: string; alternateIndex: number | null } | null => {
  const m = DIALOGUE_MSGCTXT_RE.exec(msgctxt.trim());
  if (!m) return null;
  const field = m[1]!;
  const articyId = m[3]!.toLowerCase();
  if (m[2] != null) return { field, articyId, alternateIndex: Number.parseInt(m[2], 10) };
  return { field, articyId, alternateIndex: null };
};

/** Lookup key for a spoken PO row (`dialoguetext/0x…`). */
export const discoDialogueMsgctxtKey = (field: string, articyId: string): string =>
  `${field.toLowerCase()}/${articyId.toLowerCase()}`;
