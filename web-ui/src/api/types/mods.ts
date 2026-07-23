export type Mod = {
  id: number;
  name: string;
  abs_path: string;
  version_hash: string;
  game: string;
  nexus_mod_id: number | null;
  nexus_name: string | null;
  nexus_thumbnail: string | null;
  created_at: string;
  record_count: number;
  string_count: number;
  translated_count: number;
  approved_count: number;
  fuzzy_count: number;
};
