/**
 * The game plugins this build ships.
 *
 * Importing this module registers every game. Do it once from an entry point —
 * the API server, the worker, a script, the Jest setup file — and everything
 * else can look plugins up through `src/games/registry`, which imports no
 * plugin of its own and therefore cannot form an import cycle.
 *
 * ## Adding a game
 *
 * A Creation Engine title is a descriptor in `creation-engine/titles/`: masters,
 * archive format, subrecord and record definitions, prompts. Add it there and
 * register it below.
 *
 * Anything else is a directory next to `disco-elysium/` implementing the
 * contract in `src/games/contract`: how its files are imported, how its
 * translations are exported, and (if it is voiced) how its takes are named and
 * synthesized. Nothing outside that directory needs to change.
 */
import { createCreationEnginePlugin } from './creation-engine/plugin';
import { fallout3, fallout4, fallout76, falloutNewVegas } from './creation-engine/titles/fallout';
import {
  morrowind,
  oblivion,
  skyrimLegendaryEdition,
  skyrimSpecialEdition,
} from './creation-engine/titles/elderScrolls';
import { discoElysiumPlugin } from './disco-elysium/plugin';
import { registerGamePlugin } from './registry';

/** Registration order is the order games appear in the catalogue. */
for (const title of [
  fallout4,
  fallout76,
  fallout3,
  falloutNewVegas,
  oblivion,
  morrowind,
  skyrimSpecialEdition,
  skyrimLegendaryEdition,
]) {
  registerGamePlugin(createCreationEnginePlugin(title));
}

registerGamePlugin(discoElysiumPlugin);

export * from './registry';
export type * from './contract';
