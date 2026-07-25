/**
 * Resolving the speaker and addressee of a translatable dialog string.
 *
 * The translation and validation pipelines work on `strings` rows and know
 * nothing about the dialog graph, so this module hands them a single lateral
 * join that attaches both participants and their gender to any INFO row.
 */
import {
  effectiveSpeakerGenderSql,
  parseSpeakerGender,
  resolveDialogLineParticipants,
  type AddresseeKind,
  type DialogLineParticipants,
} from '../../../../dialog';

/** Subrecord that holds the prompt the player picks, as opposed to the reply. */
const PLAYER_PROMPT_FIELD = 'RNAM';

/** True for the half of an INFO record that the player character speaks. */
export const isPlayerPromptField = (field: string | null | undefined): boolean =>
  field === PLAYER_PROMPT_FIELD;

/** Participant columns produced by {@link dialogParticipantsLateralSql}. */
export type DialogParticipantsRow = {
  speaker_name: string | null;
  speaker_gender: string | null;
  addressee_kind: string | null;
  addressee_name: string | null;
  addressee_gender: string | null;
};

/** Columns of {@link dialogParticipantsLateralSql}, for use in a SELECT list. */
export const DIALOG_PARTICIPANT_COLUMNS =
  'dp.speaker_name, dp.speaker_gender, dp.addressee_kind, dp.addressee_name, dp.addressee_gender';

/**
 * Build a `LEFT JOIN LATERAL` body resolving both participants of an INFO row.
 *
 * @param recordsAlias - Alias of the `records` row in the enclosing query.
 * @returns SQL to place between `LEFT JOIN LATERAL (` and `) dp ON TRUE`.
 */
export const dialogParticipantsLateralSql = (recordsAlias: string): string => `
    SELECT
      sp.display_name AS speaker_name,
      ${effectiveSpeakerGenderSql('sp')} AS speaker_gender,
      dn.addressee_kind,
      ad.display_name AS addressee_name,
      ${effectiveSpeakerGenderSql('ad')} AS addressee_gender
    FROM dialog_nodes dn
    JOIN dialog_topics dt
      ON dt.id = dn.topic_id
     AND dt.mod_id = ${recordsAlias}.mod_id
    LEFT JOIN dialog_speakers sp
      ON sp.mod_id = dt.mod_id AND sp.speaker_key = dn.speaker_key
    LEFT JOIN dialog_speakers ad
      ON ad.mod_id = dt.mod_id AND ad.speaker_key = dn.addressee_speaker_key
    WHERE ${recordsAlias}.signature = 'INFO'
      AND dn.info_formid_hex = ${recordsAlias}.formid_hex
    LIMIT 1`;

/**
 * Participant columns of a `dialog_nodes` row, for transcript queries.
 *
 * Unlike {@link DIALOG_PARTICIPANT_COLUMNS} these describe the node itself
 * rather than one of its strings, so the reply/prompt swap of an INFO record is
 * left to the caller, which knows which half it is rendering.
 */
export const DIALOG_NODE_PARTICIPANT_COLUMNS = `dn.speaker_key,
      ${effectiveSpeakerGenderSql('nsp')} AS speaker_gender,
      dn.addressee_kind,
      nad.display_name AS addressee_name,
      ${effectiveSpeakerGenderSql('nad')} AS addressee_gender`;

/**
 * Joins that {@link DIALOG_NODE_PARTICIPANT_COLUMNS} needs.
 *
 * @param modIdExpr - SQL expression yielding the mod that owns the node,
 * e.g. `dt.mod_id`.
 */
export const dialogNodeSpeakerJoinsSql = (modIdExpr: string): string => `
     LEFT JOIN dialog_speakers nsp
       ON nsp.mod_id = ${modIdExpr} AND nsp.speaker_key = dn.speaker_key
     LEFT JOIN dialog_speakers nad
       ON nad.mod_id = ${modIdExpr} AND nad.speaker_key = dn.addressee_speaker_key`;

/** Narrow a stored `dialog_nodes.addressee_kind` value to an {@link AddresseeKind}. */
export const parseAddresseeKind = (value: string | null | undefined): AddresseeKind =>
  value === 'player' || value === 'npc' ? value : 'unknown';

/**
 * Turn raw participant columns into the speaker/addressee pair of one line.
 *
 * @param field - Subrecord the string came from; `RNAM` flips the roles because
 * that half of an INFO record is spoken by the player.
 */
export const dialogParticipantsFromRow = (
  row: Partial<DialogParticipantsRow>,
  field: string | null | undefined,
): DialogLineParticipants =>
  resolveDialogLineParticipants({
    isPlayerPrompt: isPlayerPromptField(field),
    nodeSpeakerName: row.speaker_name ?? null,
    nodeSpeakerGender: parseSpeakerGender(row.speaker_gender),
    addresseeKind: parseAddresseeKind(row.addressee_kind ?? null),
    addresseeName: row.addressee_name ?? null,
    addresseeGender: parseSpeakerGender(row.addressee_gender),
  });
