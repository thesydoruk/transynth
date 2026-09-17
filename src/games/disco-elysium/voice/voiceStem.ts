/**
 * Disco Final Cut Audio/ stem layout: `{Actor}-{Conversation}-{entryId}`.
 */
const ALT_PREFIX_RE = /^alternative-(\d+)-/i;
const FIXED_PREFIX_RE = /^fixed-/i;
const TRAILING_ID_RE = /-(\d+)$/;
/**
 * Actor + ALL-CAPS conversation + entry id.
 * Non-greedy actor so `Mega Rich Light-Bending Guy-CONTAINERYARD  GUY-12`
 * does not split on the hyphen inside the name. Conversation titles in the
 * pack start with a 3+ letter location/code (`YARD`, `INVENTORY`, `WHIRLING`).
 */
const ACTOR_CAPS_CONV_ID_RE = /^(.+?)-([A-Z]{3,}[A-Z0-9 \-']*)-(\d+)$/;

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

/**
 * Collapse punctuation/spaces/accents so PO Title/Actor match wav names
 * (`Call Me Mañana` → `Call Me Manana`, `René` → `Rene`).
 */
export const crushDiscoVoiceToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Prefer ASCII wav twins over accented or replacement-char duplicate filenames. */
export const discoWavStemAsciiScore = (stem: string): number => {
  if (stem.includes('\uFFFD')) return 0;
  if (/[^\u0000-\u007F]/.test(stem)) return 1;
  return 2;
};

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

const NO_CONVERSATIONS: ReadonlySet<string> = new Set();

/**
 * Trimmed conversation titles as a lookup, memoized per catalogue.
 *
 * Every wav in the pack is parsed against the same catalogue — 48 000 stems
 * against 4 000 titles — so rebuilding it per stem is the difference between
 * opening the voice tab and waiting for it.
 */
const catalogCache = new WeakMap<object, ReadonlySet<string>>();
const conversationLookup = (names: Iterable<string>): ReadonlySet<string> => {
  const cacheKey = typeof names === 'object' && names !== null ? (names as object) : null;
  const hit = cacheKey ? catalogCache.get(cacheKey) : undefined;
  if (hit) return hit;
  const lookup = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed) lookup.add(trimmed);
  }
  if (cacheKey) catalogCache.set(cacheKey, lookup);
  return lookup;
};

/**
 * Split a wav stem using known conversation titles (longest match) so actor
 * names that contain hyphens still parse.
 */
export const parseDiscoWavStem = (
  stem: string,
  conversationNames: Iterable<string> = NO_CONVERSATIONS,
): DiscoWavStemParts | null => {
  const { rest: withoutFixed } = stripFixedPrefix(stem.trim());
  const { rest: afterAlt, alternativeIndex } = stripAlternativePrefix(withoutFixed);
  let body = afterAlt;
  if (alternativeIndex != null) {
    const trail = TRAILING_ID_RE.exec(body);
    if (trail) body = body.slice(0, trail.index);
  }

  // `{actor}-{conversation}-{entryId}`: the actor may hold hyphens, so try each
  // split point, longest conversation first, and keep the one the pack knows.
  const catalog = conversationLookup(conversationNames);
  const trailingId = catalog.size > 0 ? TRAILING_ID_RE.exec(body) : null;
  if (trailingId) {
    const left = body.slice(0, trailingId.index);
    for (let i = 1; i < left.length - 1; i++) {
      if (left[i] !== '-') continue;
      const conv = left.slice(i + 1);
      if (!catalog.has(conv)) continue;
      const actor = left.slice(0, i).trim();
      if (!actor) continue;
      return {
        stem,
        actor,
        conversation: conv,
        entryId: Number.parseInt(trailingId[1]!, 10),
        alternativeIndex,
        mainStem: `${actor}-${conv}-${trailingId[1]}`,
      };
    }
  }

  const caps = ACTOR_CAPS_CONV_ID_RE.exec(body);
  if (caps) {
    const actor = caps[1]!.trim();
    const conversation = caps[2]!.trim();
    const entryId = Number.parseInt(caps[3]!, 10);
    if (actor && conversation) {
      return {
        stem,
        actor,
        conversation,
        entryId,
        alternativeIndex,
        mainStem: `${actor}-${conversation}-${entryId}`,
      };
    }
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

/**
 * True when a wav under `Audio/` is a dialogue take rather than music, ambience
 * or foley.
 *
 * `Audio/` is flat and holds the whole soundtrack: `city-birds-01`,
 * `door-open-01`, `01 Instrument of Surrender`, `MOZOVIAN SOCIO-ECONOMICS_TITLE`.
 * A take carries an actor, a conversation the lockit knows, and an entry id;
 * nothing else does, so an unknown conversation is the signal. Without a
 * conversation catalogue there is nothing to check against and every wav counts
 * — better a soundtrack file in the list than a missing line.
 */
export const isDiscoDialogueWavStem = (
  stem: string,
  conversationNames: ReadonlySet<string>,
): boolean => {
  if (conversationNames.size === 0) return true;
  const parsed = parseDiscoWavStem(stem, conversationNames);
  return parsed != null && conversationNames.has(parsed.conversation);
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
