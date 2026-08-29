/**
 * Entire-line vocalizations that TTS cannot reproduce (combat grunts, fillers,
 * laughs, bare SFX words). Callers must pass text already stripped of `*…*` /
 * `[…]` so mixed dialogue (`*grunt* Let go!`) is not skipped.
 */

const PUNCT_ONLY_RE = /^[\s.!?…,;:\-–—*'"“”‘’()[\]]+$/;

/** Strip wrapping punctuation from one token. */
const stripTokenPunct = (token: string): string =>
  token.replace(/^[.!?…,;:\-–—*'"“”‘’]+|[.!?…,;:\-–—*'"“”‘’]+$/g, '').trim();

/** Speakable interjections — TTS can say these; do not treat as grunts. */
const KEEP_WORDS = new Set([
  'hey',
  'hi',
  'hello',
  'yes',
  'no',
  'ok',
  'okay',
  'oh',
  'ah',
  'huh',
  'what',
  'wait',
  'wow',
  'ow',
  'ouch',
  'thanks',
  'please',
  'sorry',
  'bye',
  'yeah',
  'yep',
  'yup',
  'nope',
  'sure',
  'fine',
  'good',
  'well',
  'right',
  'alright',
  'alrighty',
  'here',
  'there',
  'now',
  'stop',
  'go',
  'come',
  'look',
  'listen',
  'help',
  'sir',
  'aye',
  'nay',
  'yo',
  'oi',
  'eh',
  'er',
  'uh',
  'um',
]);

const SFX_WORDS = new Set([
  'sigh',
  'sighs',
  'sighing',
  'cough',
  'coughs',
  'coughing',
  'laugh',
  'laughs',
  'laughing',
  'laughter',
  'groan',
  'groans',
  'groaning',
  'grunt',
  'grunts',
  'grunting',
  'gasp',
  'gasps',
  'gasping',
  'pant',
  'pants',
  'panting',
  'chuckle',
  'chuckles',
  'chuckling',
  'ahem',
  'yelp',
  'yelps',
  'growl',
  'growls',
  'bark',
  'barks',
  'roar',
  'roars',
  'hiss',
  'hisses',
  'snarl',
  'snarls',
  'whistle',
  'whistling',
  'belch',
  'static',
  'humming',
]);

/** Thinking / scoff fillers: Hm, Hmm…, Hmph. */
const FILLER_RE = /^h+m+p*h*$/i;

/** Laughs only — not Hi / Ho. */
const LAUGH_RE = /^(?:ha+|hah+|hee+|heh+|hehe+|hoho+)(?:[\s-]*(?:ha+|hah+|hee+|heh+|hehe+))*$/i;

/** Fallout-style effort / pain / death spellings (Agh, Oof, Grrargh, Nnh). */
const PHONETIC_PATTERNS: RegExp[] = [
  /^n?a+[iy]*r*g+h*$/i,
  /^w[eia]+r+g+h*$/i,
  /^o+f+$/i,
  /^u+[grn]+h*$/i,
  /^g+a+h*$/i,
  /^e+r+g+h*$/i,
  /^h+n+g+h*$/i,
  /^n+h+$/i,
  /^u+n+[gf]+h*$/i,
  /^a+c+k+$/i,
  /^g+r+[argh]+$/i,
  /^n+[yia]+r+g+h*$/i,
  /^y+[ea]+r+g+h*$/i,
  /^h+y+[ar]+g+h*$/i,
  /^r+a+r+g+h*$/i,
  /^m+m*[pbf]+h*$/i,
  /^p+f+t+$/i,
  /^t+s+k+$/i,
  /^a+h+e+m+$/i,
  /^b+l+[ae]+r+g+h*$/i,
];

/** Ukrainian phonetic counterparts: Агх, Уф, Наргх, Грраргх, Ннх. */
const UK_PHONETIC_PATTERNS: RegExp[] = [
  /^[а]+р*г+х*$/iu,
  /^у+ф+$/iu,
  /^о+х+$/iu,
  /^н+[ьиіяй]*а*р+г+х*$/iu,
  /^н+х+$/iu,
  /^в[іеиї]+р+г+х*$/iu,
  /^г+а+х*$/iu,
  /^е+р+г*$/iu,
  /^х+м+ф*$/iu,
  /^к+х+м+$/iu,
  /^х+а+$/iu,
  /^х+е+$/iu,
  /^п+ф+$/iu,
  /^т+ь?х+у*$/iu,
  /^г+р+$/iu,
  /^г+р+[ар]*г+х*$/iu,
  /^у+н+г+х*$/iu,
  /^у+р+г+х*$/iu,
  /^й[ея]*а*р+г+х*$/iu,
];

const matchesAny = (token: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(token));

const isVocalizationToken = (raw: string): boolean => {
  const token = stripTokenPunct(raw);
  if (!token) return true;
  const lower = token.toLowerCase();
  if (KEEP_WORDS.has(lower)) return false;
  if (SFX_WORDS.has(lower)) return true;
  if (FILLER_RE.test(token) || LAUGH_RE.test(token)) return true;
  return matchesAny(token, PHONETIC_PATTERNS) || matchesAny(token, UK_PHONETIC_PATTERNS);
};

/**
 * True when the entire line is a non-lexical vocalization (no real words).
 *
 * @example isPhoneticVocalizationLine('Agh!') → true
 * @example isPhoneticVocalizationLine('Hmm...') → true
 * @example isPhoneticVocalizationLine('Ha ha ha!') → true
 * @example isPhoneticVocalizationLine('Grrrah! Let go!') → false
 * @example isPhoneticVocalizationLine('Hey.') → false
 */
export const isPhoneticVocalizationLine = (text: string): boolean => {
  const line = text.trim();
  if (!line) return false;
  if (PUNCT_ONLY_RE.test(line)) return true;
  const tokens = line.split(/\s+/).map(stripTokenPunct).filter(Boolean);
  return tokens.length > 0 && tokens.every(isVocalizationToken);
};
