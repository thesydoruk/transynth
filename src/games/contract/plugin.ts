import type { GameId } from '../../types';
import type { GameCatalogueEntry } from './catalogue';
import type { GameEditorCapabilities } from './editor';
import type { GameTextAdapter } from './text';
import type { GamePromptAdapter } from './prompts';
import type { GameImportAdapter } from './importing';
import type { GameExportAdapter } from './exporting';
import type { GameVoiceAdapter } from './voice';
import type { GameDialogAdapter } from './dialog';
import type { GameDeploymentAdapter } from './deployment';

/**
 * Everything Transynth knows about one game.
 *
 * A plugin is the *only* place a game id may be reasoned about. Shared code
 * looks a plugin up once (`gamePlugin(id)`) and then calls through these
 * adapters, so adding a title is writing one of these objects and registering
 * it — never editing a pipeline, a `switch`, or a `Record<GameId, …>` map.
 *
 * Adapters are deliberately coarse. Games differ in ways that cut across
 * layers — a Unity title with gettext catalogues shares nothing with a
 * Creation Engine title beyond "text goes in, files come out" — so each
 * adapter owns a whole stage of the pipeline rather than a single hook.
 *
 * Optional adapters mean "this game does not have that stage": no `voice`
 * for a silent game, no `deployment` for a game no mod manager deploys.
 */
export type GamePlugin = {
  /** Identifier used in URLs, the `mods.game` column, and plugin lookups. */
  readonly id: GameId;
  readonly catalogue: GameCatalogueEntry;
  /**
   * Which game's *stored* rows this title reads and writes.
   *
   * Editions that ship the same text share a term list and a QA rule set
   * rather than duplicating them: Skyrim LE points its glossary at Skyrim SE,
   * Fallout 76 points its QA rules at Fallout 4. A title with data of its own
   * points every key at itself.
   */
  readonly storageKeys: {
    glossary: GameId;
    qaRules: GameId;
  };
  readonly editor: GameEditorCapabilities;
  readonly text: GameTextAdapter;
  readonly prompts: GamePromptAdapter;
  readonly import: GameImportAdapter;
  readonly export: GameExportAdapter;
  /**
   * Who speaks each line. Unset for a game with no spoken dialogue — its
   * lines then carry no participants rather than empty ones.
   */
  readonly dialog?: GameDialogAdapter;
  readonly voice?: GameVoiceAdapter;
  readonly deployment?: GameDeploymentAdapter;
};
