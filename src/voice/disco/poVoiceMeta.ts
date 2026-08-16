/**
 * Scan Disco Translator `.po` files for spoken-line comments (Actor, Title, Articy id).
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
};

const MSGCTXT_RE = /^msgctxt\s+"(Dialogue Text|Alternate\d+)\/(0x[0-9A-Fa-f]+)"\s*$/;
const COMMENT_RE = /^#\s+([^=]+)=(.*)$/;

const flushComments = (): { actor: string; title: string } => ({ actor: '', title: '' });

/** Parse one lockit `.po` for Dialogue Text / AlternateN rows with Actor + Title. */
export const scanDiscoPoSpokenLines = (poPath: string): DiscoPoSpokenLine[] => {
  const text = fs.readFileSync(poPath, 'utf8');
  const lines: DiscoPoSpokenLine[] = [];
  let comments = flushComments();

  for (const raw of text.split(/\r?\n/)) {
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
      const field = msgctxt[1]!;
      const articyId = msgctxt[2]!.toLowerCase();
      const conversation = discoConversationFromTitle(comments.title);
      lines.push({
        field,
        articyId,
        actor: comments.actor,
        title: comments.title,
        conversation,
        actorKey: crushDiscoVoiceToken(comments.actor),
        conversationKey: crushDiscoVoiceToken(conversation),
      });
      comments = flushComments();
      continue;
    }
    if (raw.startsWith('msgid ') || raw.startsWith('msgstr ')) {
      comments = flushComments();
    }
  }
  return lines;
};
