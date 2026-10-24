/**
 * The canonical names a batch mentions, handed to the editor next to the lines.
 *
 * In the Fallout 4 review this was what stopped one batch writing "Фанел-хол"
 * while the map said "Фейніл-Голл". Possessives and plurals count as mentions
 * ("Hancock's", "Synths"); a name the batch itself defines (an NPC's or a
 * location's own FULL record) is left out, because that line is under review.
 */
import type { GameNameCanon } from '../games/contract';
import type { ReviewUnit } from './types';

/** Records whose FULL field is the name itself. */
const NAME_SIGNATURES = new Set(['NPC_', 'LCTN', 'CELL', 'FACT', 'WRLD', 'QUST']);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type NameMatcher = (units: readonly ReviewUnit[]) => Record<string, string>;

/** Build once per run: compiles a pattern per name, indexed by first word. */
export const createNameMatcher = (canon: GameNameCanon | undefined): NameMatcher => {
  if (!canon) return () => ({});
  const generic = new Set(canon.generic.map((g) => g.toLowerCase()));
  const byFirstWord = new Map<string, { en: string; uk: string; re: RegExp }[]>();
  for (const [en, uk] of Object.entries(canon.names)) {
    if (en.length < 3 || !uk || en === uk || generic.has(en.toLowerCase())) continue;
    // Same tokenisation as the batch text below, so "D.B." files under "D", "Drinkin'" under "Drinkin".
    const first = en.match(/[A-Za-z0-9-]+/)?.[0];
    if (!first) continue;
    const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(en)}(?:'s|s|es)?(?![A-Za-z])`);
    (byFirstWord.get(first) ?? byFirstWord.set(first, []).get(first)!).push({ en, uk, re });
  }

  return (units) => {
    const text = units.flatMap((u) => u.lines.map((l) => l.src)).join('\n');
    const words = new Set(text.match(/[A-Za-z0-9-]+/g) ?? []);
    const defined = new Set(
      units.flatMap((u) =>
        u.lines
          .filter((l) => l.field === 'FULL' && l.sig && NAME_SIGNATURES.has(l.sig))
          .map((l) => l.src.trim()),
      ),
    );
    const found: Record<string, string> = {};
    // "Synths" and "Hancocks" must reach the names filed under "Synth" and "Hancock".
    const firstWords = new Set(
      [...words].flatMap((w) => [w, w.replace(/s$/, ''), w.replace(/es$/, '')]),
    );
    for (const word of firstWords) {
      for (const name of byFirstWord.get(word) ?? []) {
        if (!defined.has(name.en) && name.re.test(text)) found[name.en] = name.uk;
      }
    }
    return Object.fromEntries(Object.entries(found).sort((a, b) => a[0].localeCompare(b[0], 'en')));
  };
};
