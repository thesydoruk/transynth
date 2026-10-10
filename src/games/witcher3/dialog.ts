/**
 * Who speaks a Witcher 3 line, and to whom.
 *
 * The scene files name both for every line (see `scenes/`), and the import puts
 * them on the line's voice clip: `speaker_key` is the speaker's voice tag,
 * `game_data.addressee` the listener's, and both are `dialog_speakers` rows with
 * the gender the game's voice-tag table gives. So the lookup is one join from
 * the record to its clip.
 *
 * Geralt is the player, and written male. Ciri's playable stretches need no
 * special case: her lines name her as the speaker.
 */
import { effectiveSpeakerGenderSql } from '../../dialog';
import type { DialogParticipantsSqlContext, GameDialogAdapter } from '../contract';
import { W3_DIALOGUE_SIGNATURE } from './import/tables';

export const witcher3DialogAdapter: GameDialogAdapter = {
  playerGender: 'male',

  isSpokenSignature: (signature) => signature === W3_DIALOGUE_SIGNATURE,

  /** Every scene line is its own record; there is no prompt half to swap. */
  isPlayerPromptField: () => false,

  lineSpeakerSql: ({ records, gameList }: DialogParticipantsSqlContext): string => `
    SELECT
      sp.display_name,
      ${effectiveSpeakerGenderSql('sp')} AS gender
    FROM voice_clips vc
    JOIN mods gm
      ON gm.id = ${records}.mod_id AND gm.game IN (${gameList})
    JOIN dialog_speakers sp
      ON sp.mod_id = vc.mod_id AND sp.speaker_key = vc.speaker_key
    WHERE vc.mod_id = ${records}.mod_id
      AND vc.record_id = ${records}.id
    LIMIT 1`,

  participantsSql: ({ records, gameList }: DialogParticipantsSqlContext): string => `
    SELECT
      vc.speaker_key,
      sp.display_name AS speaker_name,
      ${effectiveSpeakerGenderSql('sp')} AS speaker_gender,
      COALESCE(sp.is_player, FALSE) AS speaker_is_player,
      CASE
        WHEN ad.is_player THEN 'player'
        WHEN ad.speaker_key IS NOT NULL THEN 'npc'
        ELSE 'unknown'
      END AS addressee_kind,
      ad.display_name AS addressee_name,
      ${effectiveSpeakerGenderSql('ad')} AS addressee_gender
    FROM voice_clips vc
    JOIN mods gm
      ON gm.id = ${records}.mod_id AND gm.game IN (${gameList})
    LEFT JOIN dialog_speakers sp
      ON sp.mod_id = vc.mod_id AND sp.speaker_key = vc.speaker_key
    LEFT JOIN dialog_speakers ad
      ON ad.mod_id = vc.mod_id AND ad.speaker_key = vc.game_data->>'addressee'
    WHERE vc.mod_id = ${records}.mod_id
      AND vc.record_id = ${records}.id
    LIMIT 1`,
};
