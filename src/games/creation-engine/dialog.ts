/**
 * Who speaks a Creation Engine line.
 *
 * Bethesda keeps dialogue as an INFO/DIAL graph: an INFO record holds one
 * exchange, the `ANAM` actor speaks the reply, and `RNAM` — when present — is
 * the prompt the player picked to get it. Import walks that graph into
 * `dialog_nodes` / `dialog_speakers`, so the lookup here is a join on the
 * record's FormID.
 *
 * Shared across every title: the graph is the same in Morrowind and in
 * Fallout 76, and the lateral builder groups titles by adapter identity, so one
 * instance keeps the composed SQL to a single branch for all eight.
 */
import type { DialogParticipantsSqlContext, GameDialogAdapter } from '../contract';
import { effectiveSpeakerGenderSql } from '../../dialog';

/** Record type holding one spoken exchange. */
const INFO = 'INFO';

/** Subrecord holding the prompt the player picks, as opposed to the reply. */
const PLAYER_PROMPT_FIELD = 'RNAM';

/** `records.path_simplified` of that same half, as the grid query sees it. */
const PLAYER_PROMPT_PATH = `${INFO}\\${PLAYER_PROMPT_FIELD}`;

/** Record whose text is an actor's own name. */
const ACTOR = 'NPC_';

export const creationEngineDialogAdapter: GameDialogAdapter = {
  // Chosen at character creation in every Bethesda title.
  playerGender: 'any',

  isSpokenSignature: (signature) => signature === INFO,

  isPlayerPromptField: (field) => field === PLAYER_PROMPT_FIELD,

  /**
   * Three kinds of row carry a voice in a Bethesda plugin, and the grid shows
   * all three: the player's half of an exchange (`RNAM`), the NPC reply, and an
   * `NPC_` record, whose text is the actor's own name — a translator needs the
   * actor's gender to decline it.
   */
  lineSpeakerSql: ({ records, gameList }: DialogParticipantsSqlContext): string => `
    SELECT display_name, gender FROM (
      SELECT
        CASE WHEN ${records}.path_simplified = '${PLAYER_PROMPT_PATH}'
             THEN NULL::text ELSE sp.display_name END AS display_name,
        CASE WHEN ${records}.path_simplified = '${PLAYER_PROMPT_PATH}'
             THEN 'any' ELSE ${effectiveSpeakerGenderSql('sp')} END AS gender
      FROM dialog_nodes dn
      JOIN dialog_topics dt
        ON dt.id = dn.topic_id AND dt.mod_id = ${records}.mod_id
      JOIN mods gm
        ON gm.id = ${records}.mod_id AND gm.game IN (${gameList})
      LEFT JOIN dialog_speakers sp
        ON sp.mod_id = dt.mod_id AND sp.speaker_key = dn.speaker_key
      WHERE ${records}.signature = '${INFO}'
        AND dn.info_formid_hex = ${records}.formid_hex

      UNION ALL

      SELECT
        COALESCE(NULLIF(sp.display_name, ''), NULLIF(${records}.edid, '')) AS display_name,
        ${effectiveSpeakerGenderSql('sp')} AS gender
      FROM dialog_speakers sp
      JOIN mods gm
        ON gm.id = ${records}.mod_id AND gm.game IN (${gameList})
      WHERE ${records}.signature = '${ACTOR}'
        AND sp.mod_id = ${records}.mod_id
        AND sp.speaker_key = 'npc:' || upper(${records}.formid_hex)
    ) ce_line_speaker
    LIMIT 1`,

  participantsSql: ({ records, gameList }: DialogParticipantsSqlContext): string => `
    SELECT
      dn.speaker_key,
      sp.display_name AS speaker_name,
      ${effectiveSpeakerGenderSql('sp')} AS speaker_gender,
      COALESCE(sp.is_player, FALSE) AS speaker_is_player,
      dn.addressee_kind,
      ad.display_name AS addressee_name,
      ${effectiveSpeakerGenderSql('ad')} AS addressee_gender
    FROM dialog_nodes dn
    JOIN dialog_topics dt
      ON dt.id = dn.topic_id
     AND dt.mod_id = ${records}.mod_id
    JOIN mods gm
      ON gm.id = ${records}.mod_id AND gm.game IN (${gameList})
    LEFT JOIN dialog_speakers sp
      ON sp.mod_id = dt.mod_id AND sp.speaker_key = dn.speaker_key
    LEFT JOIN dialog_speakers ad
      ON ad.mod_id = dt.mod_id AND ad.speaker_key = dn.addressee_speaker_key
    WHERE ${records}.signature = '${INFO}'
      AND dn.info_formid_hex = ${records}.formid_hex
    LIMIT 1`,
};
