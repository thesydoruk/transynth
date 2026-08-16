/**
 * Disco Final Cut Audio/ stem layout: `{Actor}-{Conversation}-{entryId}`.
 */
const ALT_PREFIX_RE = /^alternative-(\d+)-/i;
const FIXED_PREFIX_RE = /^fixed-/i;
const TRAILING_ID_RE = /-(\d+)$/;

export type DiscoWavStemParts = {
  /** Basename without extension (as on disk). */
  stem: string;
  actor: string;
  conversation: string;
  entryId: number;
  /** `alternative-N-…` index, or null for the main take. */
  alternativeIndex: number | null;
  /** Main clip stem used to attach AlternateN takes. */
  mainStem: string;
};

/** Collapse punctuation/spaces so PO Title and wav conversation names match. */
export const crushDiscoVoiceToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** `WHIRLING F2 / TEQUILA DOOR` → `WHIRLING F2  TEQUILA DOOR` (wav conversation form). */
export const discoConversationFromTitle = (title: string): string =>
  title.replace(/\s*\/\s*/g, '  ').trim();

const stripFixedPrefix = (stem: string): { rest: string; hadFixed: boolean } => {
  if (FIXED_PREFIX_RE.test(stem)) return { rest: stem.slice(6), hadFixed: true };
  return { rest: stem, hadFixed: false };
};

const stripAlternativePrefix = (
  stem: string,
): { rest: string; alternativeIndex: number | null } => {
  const m = ALT_PREFIX_RE.exec(stem);
  if (!m) return { rest: stem, alternativeIndex: null };
  return { rest: stem.slice(m[0].length), alternativeIndex: Number.parseInt(m[1]!, 10) };
};

/**
 * Split a wav stem using known conversation titles (longest match) so actor
 * names that contain hyphens still parse.
 */
export const parseDiscoWavStem = (
  stem: string,
  conversationNames: Iterable<string> = [],
): DiscoWavStemParts | null => {
  const { rest: withoutFixed } = stripFixedPrefix(stem.trim());
  const { rest: afterAlt, alternativeIndex } = stripAlternativePrefix(withoutFixed);
  let body = afterAlt;
  if (alternativeIndex != null) {
    const trail = TRAILING_ID_RE.exec(body);
    if (trail) body = body.slice(0, trail.index);
  }

  const catalog = [...new Set([...conversationNames].map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const conv of catalog) {
    const needle = `-${conv}-`;
    const idx = body.indexOf(needle);
    if (idx <= 0) continue;
    const actor = body.slice(0, idx).trim();
    const afterConv = body.slice(idx + needle.length);
    const idMatch = /^(\d+)$/.exec(afterConv);
    if (!actor || !idMatch) continue;
    const mainStem = `${actor}-${conv}-${idMatch[1]}`;
    return {
      stem,
      actor,
      conversation: conv,
      entryId: Number.parseInt(idMatch[1]!, 10),
      alternativeIndex,
      mainStem,
    };
  }

  const idMatch = TRAILING_ID_RE.exec(body);
  if (!idMatch) return null;
  const left = body.slice(0, idMatch.index);
  const dash = left.indexOf('-');
  if (dash <= 0) return null;
  const actor = left.slice(0, dash).trim();
  const conversation = left.slice(dash + 1).trim();
  if (!actor || !conversation) return null;
  const mainStem = `${actor}-${conversation}-${idMatch[1]}`;
  return {
    stem,
    actor,
    conversation,
    entryId: Number.parseInt(idMatch[1]!, 10),
    alternativeIndex,
    mainStem,
  };
};

/** Speaker folder token from asset name (`alternative-0-Kim-YARD-1-0` → `Kim`). */
export const discoSpeakerKeyFromStem = (
  stem: string,
  conversationNames: Iterable<string> = [],
): string => {
  const parsed = parseDiscoWavStem(stem, conversationNames);
  if (parsed) return parsed.actor;
  const { rest: withoutFixed } = stripFixedPrefix(stem.trim());
  const { rest } = stripAlternativePrefix(withoutFixed);
  const cut = rest.split(/[-_/]/)[0]?.trim();
  return cut && cut.length > 0 ? cut : 'Unknown';
};
