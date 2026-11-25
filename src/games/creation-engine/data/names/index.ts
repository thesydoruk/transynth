/**
 * Fallout 4 name canon, EN → UK: characters, places, factions and quests as the
 * game displays them. Built from the corpus reviewed on 2026-10-21 (base game
 * and DLC win over mods); see doc/reviews/fo4-uk-2026-10-21.
 *
 * `fo4-uk.generic.json` holds the one-word names that the same corpus mostly
 * writes in lowercase as ordinary words — a lowercase share of at least 0.2 over
 * 212,775 reviewed source lines (2026-10-24): Don, Red, Storage, Guard. As hints
 * they would fire on "Don't" and on a red door.
 */
import type { GameNameCanon } from '../../../contract';
import fo4UkNames from './fo4-uk.json' with { type: 'json' };
import fo4UkGeneric from './fo4-uk.generic.json' with { type: 'json' };
import sf1UkNames from './sf1-uk.json' with { type: 'json' };
import sf1UkGeneric from './sf1-uk.generic.json' with { type: 'json' };

export const FO4_UK_NAME_CANON: GameNameCanon = { names: fo4UkNames, generic: fo4UkGeneric };

/**
 * Starfield name canon, EN → UK. There is no official Ukrainian release, so the
 * canon is the project's own, settled in the 2026-11 translation of the base
 * game and its add-ons.
 */
export const SF1_UK_NAME_CANON: GameNameCanon = { names: sf1UkNames, generic: sf1UkGeneric };
