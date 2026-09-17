/**
 * Scan Disco Translator `.po` files for spoken-line comments (Actor, Title, Articy id).
 *
 * File order matters: the wav↔text index pairs these rows with `Audio/` takes
 * in the order both sides were exported, so this is a line scanner rather than
 * a gettext parse (which would hand back an unordered map without comments).
 */
import fs from 'node:fs';
import { discoConversationFromTitle, crushDiscoVoiceToken } from './voiceStem';

export type DiscoPoSpokenLine = {
  field: string;
  articyId: string;
  actor: string;
  title: string;
  conversation: string;
  actorKey: string;
  conversationKey: string;
  /** English source text, needed to match a take against what it says. */
  msgid: string;
};

const MSGCTXT_RE = /^msgctxt\s+"(Dialogue Text|Alternate\d+)\/(0x[0-9A-Fa-f]+)"\s*$/;
const COMMENT_RE = /^#\s+([^=]+)=(.*)$/;
const MSGID_RE = /^msgid\s+"((?:[^"\\]|\\.)*)"\s*$/;
const CONTINUATION_RE = /^"((?:[^"\\]|\\.)*)"\s*$/;

const flushComments = (): { actor: string; title: string } => ({ actor: '', title: '' });

/** gettext string escapes; the rest stay as written. */
const unescapePoString = (value: string): string =>
  value.replace(/\\(.)/g, (match, char: string) => {
    if (char === 'n') return '\n';
    if (char === 't') return '\t';
    if (char === 'r') return '\r';
    if (char === '"') return '"';
    if (char === '\\') return '\\';
    return match;
  });

type PendingLine = { field: string; articyId: string; actor: string; title: string };

/** Parse one lockit `.po` for Dialogue Text / AlternateN rows with Actor + Title. */
export const scanDiscoPoSpokenLines = (poPath: string): DiscoPoSpokenLine[] => {
  const text = fs.readFileSync(poPath, 'utf8');
  const lines: DiscoPoSpokenLine[] = [];
  let comments = flushComments();
  let pending: PendingLine | null = null;
  let msgid = '';
  let inMsgid = false;

  const commit = (): void => {
    if (!pending) return;
    const conversation = discoConversationFromTitle(pending.title);
    lines.push({
      field: pending.field,
      articyId: pending.articyId,
      actor: pending.actor,
      title: pending.title,
      conversation,
      actorKey: crushDiscoVoiceToken(pending.actor),
      conversationKey: crushDiscoVoiceToken(conversation),
      msgid,
    });
    pending = null;
    msgid = '';
    inMsgid = false;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (inMsgid) {
      const continuation = CONTINUATION_RE.exec(raw);
      if (continuation) {
        msgid += unescapePoString(continuation[1]!);
        continue;
      }
      inMsgid = false;
    }

    const comment = COMMENT_RE.exec(raw);
    if (comment) {
      const key = comment[1]!.trim();
      const value = comment[2]!.trim();
      if (key === 'Actor') comments.actor = value;
      if (key === 'Title') comments.title = value;
      continue;
    }

    const msgctxt = MSGCTXT_RE.exec(raw);
    if (msgctxt) {
      commit();
      pending = {
        field: msgctxt[1]!,
        articyId: msgctxt[2]!.toLowerCase(),
        actor: comments.actor,
        title: comments.title,
      };
      comments = flushComments();
      continue;
    }

    const msgidLine = MSGID_RE.exec(raw);
    if (msgidLine && pending) {
      msgid = unescapePoString(msgidLine[1]!);
      inMsgid = true;
      continue;
    }

    if (raw.startsWith('msgstr')) {
      commit();
      continue;
    }
    if (raw.startsWith('msgid ')) comments = flushComments();
  }
  commit();
  return lines;
};
