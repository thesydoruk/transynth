/**
 * What switching effort tags on would do for one game — the numbers Settings →
 * Voice shows next to the switch and in its confirmation.
 *
 * A take that gains a tag gets a new version stamp, so every take of it that
 * was already synthesized goes stale and the next "missing" job makes it
 * again. Those are the tagged takes with a row in `voice_synthesis_state`, in
 * any language. Rows written before stamps carried a speaker or an origin hold
 * '' there and still stand for the take, as they do for the synthesis job.
 */
import type { Tx } from '../db';
import { EFFECTIVE_EFFORT_TAG_SQL } from './voiceEffortStore';

export type VoiceEffortGameSummary = {
  /** Mods of the game with at least one analyzed take. */
  analyzedMods: number;
  /** Takes with a tag in force (derived or chosen by hand). */
  taggedTakes: number;
  /** Tagged takes that already have a synthesized take, which the switch makes stale. */
  synthesizedTaggedTakes: number;
};

export const loadVoiceEffortGameSummary = async (
  db: Tx,
  game: string,
): Promise<VoiceEffortGameSummary> => {
  const { rows } = await db.query<{
    analyzed_mods: string;
    tagged_takes: string;
    synthesized_tagged_takes: string;
  }>(
    `WITH game_effort AS (
       SELECT mod_id, origin_plugin, speaker_key, line_key, variant, analyzed_at,
              (${EFFECTIVE_EFFORT_TAG_SQL}) AS effective_tag
         FROM voice_clip_effort
        WHERE mod_id IN (SELECT id FROM mods WHERE game = $1)
     ),
     tagged AS (
       SELECT * FROM game_effort WHERE effective_tag IS NOT NULL
     )
     SELECT
       -- A tag set by hand on a take never measured makes a row but not an analysis.
       (SELECT COUNT(DISTINCT mod_id) FROM game_effort
         WHERE analyzed_at IS NOT NULL)::text AS analyzed_mods,
       (SELECT COUNT(*) FROM tagged)::text AS tagged_takes,
       (SELECT COUNT(*)
          FROM tagged t
         WHERE EXISTS (
           SELECT 1
             FROM voice_synthesis_state s
            WHERE s.mod_id = t.mod_id
              AND s.origin_plugin IN (t.origin_plugin, '')
              AND s.line_key = t.line_key
              AND s.variant = t.variant
              AND s.speaker_key IN (t.speaker_key, '')
         ))::text AS synthesized_tagged_takes`,
    [game],
  );
  const row = rows[0];
  return {
    analyzedMods: Number(row?.analyzed_mods ?? 0),
    taggedTakes: Number(row?.tagged_takes ?? 0),
    synthesizedTaggedTakes: Number(row?.synthesized_tagged_takes ?? 0),
  };
};
