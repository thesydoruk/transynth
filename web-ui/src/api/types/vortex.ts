export type VortexGroup = {
  id: number;
  game: string;
  group_key: string;
  label: string;
  staging_path: string | null;
  game_dir: string | null;
};

export type VortexGameRelease = {
  id: number;
  version_label: string;
  release_hash: string;
  is_current: boolean;
  created_at: string;
};
