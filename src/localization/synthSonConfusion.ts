/** Longest-first Ukrainian son → synth declension map. */
const SON_TO_SYNTH: ReadonlyArray<readonly [string, string]> = [
  ['синами', 'синтами'],
  ['синах', 'синтах'],
  ['синів', 'синтів'],
  ['синам', 'синтам'],
  ['сином', 'синтом'],
  ['синові', 'синтові'],
  ['сина', 'синта'],
  ['сину', 'синту'],
  ['сині', 'синті'],
  ['сини', 'синти'],
  ['син', 'синт'],
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const applyCase = (sample: string, replacement: string): string => {
  if (sample === sample.toLocaleUpperCase('uk-UA')) {
    return replacement.toLocaleUpperCase('uk-UA');
  }
  if (sample[0] && sample[0] === sample[0].toLocaleUpperCase('uk-UA')) {
    return replacement[0]!.toLocaleUpperCase('uk-UA') + replacement.slice(1);
  }
  return replacement;
};

/** Replace mistaken son-forms with synth-forms (does not touch already-correct синт*). */
export const rewriteSonFormsToSynth = (text: string): string => {
  let out = text;
  for (const [from, to] of SON_TO_SYNTH) {
    const re = new RegExp(`(?<!\\p{L})${escapeRe(from)}(?!\\p{L})`, 'giu');
    out = out.replace(re, (match) => applyCase(match, to));
  }
  return out;
};
