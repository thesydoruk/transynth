/** What a mod row holds: the game, an official DLC, an official add-on, or a mod. */
export type ModContentKind = 'base' | 'dlc' | 'addon' | 'mod';

export type Mod = {
  id: number;
  name: string;
  abs_path: string;
  version_hash: string;
  game: string;
  nexus_mod_id: number | null;
  nexus_name: string | null;
  nexus_thumbnail: string | null;
  origin?: string;
  vortex_group_id?: number | null;
  channel?: string | null;
  content_kind: ModContentKind;
  /** True when the kind was set by hand rather than classified from the anchor file. */
  content_kind_manual: boolean;
  game_release_id?: number | null;
  version_label?: string | null;
  /** Lower-cased plugin a Vortex mod is anchored on; null without one. */
  vortex_plugin?: string | null;
  is_current?: boolean;
  created_at: string;
  record_count: number;
  string_count: number;
  translated_count: number;
  approved_count: number;
  fuzzy_count: number;
};
