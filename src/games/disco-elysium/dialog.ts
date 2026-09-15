/**
 * Who speaks a Disco Elysium line.
 *
 * There is no dialogue graph to walk: the `.po` catalogue holds the text and
 * nothing else, and the only record of who says a line is the `.wav` beside it,
 * whose stem starts with the speaker. Import already resolves that — every clip
 * is stored in `voice_clips` with the `records` row it belongs to and the
 * speaker key it came from, and those keys are the same ones `dialog_speakers`
 * is populated with. So the lookup is one join the shared pipeline could never
 * have guessed, which is the point of it living here.
 *
 * The addressee is Harry. Every voiced line in the game is delivered to the
 * player character — the skills argue with him, the NPCs talk to him — so the
 * second person in a Disco line is him unless the speaker is quoting an
 * exchange with somebody else. Measured over the reviewed corpus, 1210 lines
 * write a masculine second-person past tense against 22 feminine ones, and a
 * sample of the 22 is mostly a character addressing a third party, plus at
 * least one genuine error («ти надто швидко пішла» to Harry). Naming him is
 * therefore right far more often than hedging, and it lets the QA check find
 * the rest.
 */
import type { DialogParticipantsSqlContext, GameDialogAdapter } from '../contract';
import { effectiveSpeakerGenderSql } from '../../dialog';

/** Signatures `poSignature.ts` gives to rows that are spoken aloud. */
const SPOKEN = new Set(['DLG', 'PO']);

export const discoDialogAdapter: GameDialogAdapter = {
  /**
   * Harrier Du Bois is a written character, not a created one. Hedging his
   * lines the way a Bethesda player line must be hedged would flatten them.
   */
  playerGender: 'male',

  isSpokenSignature: (signature) => (signature ? SPOKEN.has(signature) : false),

  /** One `.po` entry is one utterance; the two halves are separate records. */
  isPlayerPromptField: () => false,

  /** The grid shows the clip's speaker; there are no actor-name records here. */
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
      'player'::text AS addressee_kind,
      NULL::text AS addressee_name,
      NULL::text AS addressee_gender
    FROM voice_clips vc
    JOIN mods gm
      ON gm.id = ${records}.mod_id AND gm.game IN (${gameList})
    LEFT JOIN dialog_speakers sp
      ON sp.mod_id = vc.mod_id AND sp.speaker_key = vc.speaker_key
    WHERE vc.mod_id = ${records}.mod_id
      AND vc.record_id = ${records}.id
    LIMIT 1`,
};
