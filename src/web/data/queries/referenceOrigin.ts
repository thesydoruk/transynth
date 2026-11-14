/**
 * Origin layers of the reference base.
 *
 * Two plugins can hold the same line on the same anchor: a patch overrides a
 * base-game record, often without changing its text. Each keeps its own
 * reference row, told apart by `reference_translations.origin_key` — the
 * plugin the translation was promoted from, not the mod's display name, which
 * changes from one import to the next.
 *
 * The key is the lower-cased plugin file name (`fallout4.esm`), the same form
 * the voice code uses for a line's origin. A mod of a game without plugin
 * files falls back to its trimmed, lower-cased name. `''` is no layer: a row
 * added by hand, or one promoted before layers existed.
 */
import type { Tx } from '../../../db/types';
import { gamePlugin } from '../../../games/registry';
import { referenceGameKey } from '../../../games/referenceKey';
import { normalizeVoiceOrigin } from '../../../voice/voiceOrigin';

/** The `mods` columns an origin key is derived from. */
export type ModOriginSource = {
  name: string;
  abs_path: string | null;
  vortex_plugin: string | null;
  game: string | null;
};

const MOD_ORIGIN_COLUMNS = 'm.id, m.name, m.abs_path, m.vortex_plugin, m.game';

/**
 * Origin key of a mod: the plugin Vortex anchored it on, else the file name of
 * its import anchor when that is one of the game's plugin files, else its name.
 */
export const referenceOriginKey = (mod: ModOriginSource): string => {
  const vortexPlugin = normalizeVoiceOrigin(mod.vortex_plugin);
  if (vortexPlugin) return vortexPlugin;

  const anchor = normalizeVoiceOrigin((mod.abs_path ?? '').split(/[\\/]/).pop());
  const dot = anchor.lastIndexOf('.');
  const extension = dot > 0 ? anchor.slice(dot) : '';
  if (extension && gamePlugin(mod.game).import.uploadExtensions.includes(extension)) return anchor;

  return normalizeVoiceOrigin(mod.name);
};

export type ModOrigin = {
  modId: number;
  name: string;
  /** Reference storage key of the mod's game. */
  game: string;
  originKey: string;
};

type ModOriginRow = ModOriginSource & { id: number };

/** Origins of the given mods, or of the mods that own the given strings. */
export const loadModOrigins = async (
  db: Tx,
  scope: { modIds: number[] } | { stringIds: number[] },
): Promise<ModOrigin[]> => {
  const { rows } =
    'modIds' in scope
      ? await db.query<ModOriginRow>(
          `SELECT ${MOD_ORIGIN_COLUMNS} FROM mods m WHERE m.id = ANY($1::int[])`,
          [scope.modIds],
        )
      : await db.query<ModOriginRow>(
          `SELECT ${MOD_ORIGIN_COLUMNS} FROM mods m
            WHERE m.id IN (
              SELECT r.mod_id FROM strings s
                JOIN records r ON r.id = s.record_id
               WHERE s.id = ANY($1::int[])
            )`,
          [scope.stringIds],
        );
  return rows.map((row) => ({
    modId: row.id,
    name: row.name,
    game: referenceGameKey(row.game),
    originKey: referenceOriginKey(row),
  }));
};

/**
 * Move rows promoted before layers existed into the layer of the mod they came
 * from: a row with no layer, not edited by hand, whose `origin_mod_name` is the
 * name of one of these mods. Where the layer already holds that anchor and
 * text, the old row is dropped instead — the layered one is newer.
 *
 * A name that two of the mods map to different keys is left alone. Returns the
 * number of rows moved or dropped.
 */
export const adoptLegacyReferenceRows = async (db: Tx, origins: ModOrigin[]): Promise<number> => {
  const layered = origins.filter((origin) => origin.originKey !== '');
  if (layered.length === 0) return 0;
  const { rows } = await db.query<{ n: number }>(
    `WITH layer AS (
       SELECT u.game, u.name, MIN(u.origin_key) AS origin_key
       FROM UNNEST($1::text[], $2::text[], $3::text[]) AS u(game, name, origin_key)
       GROUP BY u.game, u.name
       HAVING COUNT(DISTINCT u.origin_key) = 1
     ),
     legacy AS (
       SELECT rt.id, layer.origin_key,
         EXISTS (
           SELECT 1 FROM reference_translations twin
           WHERE twin.game = rt.game AND twin.src_lang = rt.src_lang
             AND twin.tgt_lang = rt.tgt_lang AND twin.formid_hex = rt.formid_hex
             AND twin.path = rt.path AND md5(twin.source_text) = md5(rt.source_text)
             AND twin.origin_key = layer.origin_key
         ) AS has_twin
       FROM reference_translations rt
       JOIN layer ON layer.game = rt.game AND layer.name = rt.origin_mod_name
       WHERE rt.origin_key = '' AND rt.origin <> 'manual'
     ),
     dropped AS (
       DELETE FROM reference_translations rt
       USING legacy
       WHERE rt.id = legacy.id AND legacy.has_twin
       RETURNING rt.id
     ),
     moved AS (
       UPDATE reference_translations rt
       SET origin_key = legacy.origin_key
       FROM legacy
       WHERE rt.id = legacy.id AND NOT legacy.has_twin
       RETURNING rt.id
     )
     SELECT (SELECT COUNT(*) FROM dropped)::int + (SELECT COUNT(*) FROM moved)::int AS n`,
    [
      layered.map((origin) => origin.game),
      layered.map((origin) => origin.name),
      layered.map((origin) => origin.originKey),
    ],
  );
  return rows[0]?.n ?? 0;
};
