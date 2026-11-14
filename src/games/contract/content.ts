/** What a mods row holds: the game itself, an official DLC, an official add-on (e.g. Creation Club), or a mod. */
export type ModContentKind = 'base' | 'dlc' | 'addon' | 'mod';

export const MOD_CONTENT_KINDS: readonly ModContentKind[] = ['base', 'dlc', 'addon', 'mod'];

export type GameContentAdapter = {
  /** Classify a mod by the file it is anchored on (basename of `mods.abs_path`, e.g. `Fallout4.esm`). */
  classify(anchorFileName: string): ModContentKind;
};
