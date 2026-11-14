/**
 * Content kind of a Creation Engine plugin file: the title's first official
 * master is the game, the other masters are DLC, `cc*` plugins are Creation
 * Club add-ons (the store's naming convention), everything else is a mod.
 */
import type { GameContentAdapter, ModContentKind } from '../contract';
import type { CreationEngineTitle } from './title';

const isCreationClubPlugin = (lower: string): boolean =>
  lower.startsWith('cc') &&
  (lower.endsWith('.esm') || lower.endsWith('.esl') || lower.endsWith('.esp'));

export const createCreationEngineContentAdapter = (
  title: Pick<CreationEngineTitle, 'deployment'>,
): GameContentAdapter => {
  const masters = title.deployment.officialMasters.map((name) => name.toLowerCase());
  return {
    classify(anchorFileName: string): ModContentKind {
      const lower = anchorFileName.toLowerCase();
      const at = masters.indexOf(lower);
      if (at === 0) return 'base';
      if (at > 0) return 'dlc';
      return isCreationClubPlugin(lower) ? 'addon' : 'mod';
    },
  };
};
