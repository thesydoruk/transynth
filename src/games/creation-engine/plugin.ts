/**
 * Build a game plugin from one Creation Engine title.
 *
 * Every Bethesda title runs the same pipeline, so the adapters are shared and
 * only the title descriptor differs. Registering the title in the Creation
 * Engine lookup happens here too, so the Bethesda pipeline modules can resolve
 * a title from a game id without threading the descriptor through.
 */
import type { GamePlugin } from '../contract';
import { CREATION_ENGINE_EDITOR } from './editor';
import { createCreationEngineExportAdapter } from './export';
import { createCreationEngineImportAdapter } from './import';
import { createCreationEngineTextAdapter } from './text';
import { creationEngineDialogAdapter } from './dialog';
import { creationEngineVoiceAdapter } from './voice';
import { registerCreationEngineTitle } from './registry';
import type { CreationEngineTitle } from './title';

export const createCreationEnginePlugin = (title: CreationEngineTitle): GamePlugin => {
  registerCreationEngineTitle(title);

  return {
    id: title.id,
    catalogue: title.catalogue,
    storageKeys: {
      glossary: title.storageKeys?.glossary ?? title.id,
      qaRules: title.storageKeys?.qaRules ?? title.id,
    },
    editor: CREATION_ENGINE_EDITOR,
    text: createCreationEngineTextAdapter(title),
    prompts: title.prompts,
    import: createCreationEngineImportAdapter(title),
    export: createCreationEngineExportAdapter(title),
    dialog: creationEngineDialogAdapter,
    voice: creationEngineVoiceAdapter,
    deployment: title.deployment,
  };
};
