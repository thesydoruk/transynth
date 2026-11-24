/**
 * A Creation Engine title for tests that differs from Fallout 4 in one thing:
 * its takes are `.wem` files named by WEM id, with an `.ffxanim` beside each.
 * No shipped title is like that in this tree yet, and the code under test must
 * not care which one is.
 */
import { createCreationEnginePlugin } from '../../games/creation-engine/plugin';
import { fallout4 } from '../../games/creation-engine/titles/fallout';
import { findGamePlugin, registerGamePlugin } from '../../games/registry';

export const WEM_TEST_GAME = 'wemtest';

/** Register the title in this test file's game registry (once) and return its id. */
export const registerWemTestGame = (): string => {
  if (!findGamePlugin(WEM_TEST_GAME)) {
    registerGamePlugin(
      createCreationEnginePlugin({
        ...fallout4,
        id: WEM_TEST_GAME,
        catalogue: { ...fallout4.catalogue, id: WEM_TEST_GAME, name: 'WEM test title' },
        voice: {
          ...fallout4.voice,
          packLangpackVoiceIntoBa2: false,
          takes: { kind: 'wem-ffxanim', codec: 'opus' },
        },
      }),
    );
  }
  return WEM_TEST_GAME;
};
