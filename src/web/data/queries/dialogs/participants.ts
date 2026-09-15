/**
 * Resolving the speaker and addressee of a translatable dialog string.
 *
 * The translation and validation pipelines work on `strings` rows and know
 * nothing about how a game records who is speaking, so this module hands them
 * one lateral join that attaches both participants and their gender.
 *
 * Where that answer comes from is each game's own business — a Creation Engine
 * INFO/DIAL graph keyed by FormID, a `.wav` stem beside a Disco `.po` entry —
 * so the branches come from the plugins and this file only stitches them
 * together. A query may span mods of different games (QA refreshes an
 * arbitrary set of string ids), so the composed lateral has to answer for all
 * of them at once rather than take a game as an argument.
 */
import { allGamePlugins, gamePlugin } from '../../../../games/registry';
import type {
  DialogParticipantsSqlContext,
  GameDialogAdapter,
} from '../../../../games/contract';
import type { GameId } from '../../../../types';
import {
  effectiveSpeakerGenderSql,
  isDefiniteGender,
  parseSpeakerGender,
  playerSpeakerGenderFromVoiceKey,
  resolveDialogLineParticipants,
  type AddresseeKind,
  type DialogLineParticipants,
} from '../../../../dialog';

/** Participant columns produced by {@link dialogParticipantsLateralSql}. */
export type DialogParticipantsRow = {
  speaker_key: string | null;
  speaker_name: string | null;
  speaker_gender: string | null;
  speaker_is_player: boolean | null;
  addressee_kind: string | null;
  addressee_name: string | null;
  addressee_gender: string | null;
};

/** Columns of {@link dialogParticipantsLateralSql}, for use in a SELECT list. */
export const DIALOG_PARTICIPANT_COLUMNS =
  'dp.speaker_key, dp.speaker_name, dp.speaker_gender, dp.speaker_is_player, dp.addressee_kind, dp.addressee_name, dp.addressee_gender';

/** Games that answer participant lookups, grouped by the adapter they share. */
const dialogAdapterGroups = (): Array<{ adapter: GameDialogAdapter; games: GameId[] }> => {
  const groups = new Map<GameDialogAdapter, GameId[]>();
  for (const plugin of allGamePlugins()) {
    if (!plugin.dialog) continue;
    const games = groups.get(plugin.dialog);
    if (games) games.push(plugin.id);
    else groups.set(plugin.dialog, [plugin.id]);
  }
  return [...groups].map(([adapter, games]) => ({ adapter, games }));
};

/** Registry ids are `[a-z0-9_-]`; anything else must not reach a SQL literal. */
const SAFE_GAME_ID = /^[a-z0-9_-]+$/i;

const gameListSql = (games: readonly GameId[]): string =>
  games
    .map((id) => {
      if (!SAFE_GAME_ID.test(id)) throw new Error(`Game id is not SQL-safe: ${id}`);
      return `'${id}'`;
    })
    .join(', ');

/** Joins one adapter's branch to the next. */
const SEPARATOR = `
    UNION ALL
`;

/** Shape of a participant row, for a game that has no lookup to offer. */
const NO_PARTICIPANTS_SQL = `
    SELECT
      NULL::text AS speaker_key,
      NULL::text AS speaker_name,
      NULL::text AS speaker_gender,
      FALSE AS speaker_is_player,
      NULL::text AS addressee_kind,
      NULL::text AS addressee_name,
      NULL::text AS addressee_gender
    WHERE FALSE`;

/**
 * Join one lateral body per dialog adapter, each guarded to its own games.
 *
 * A row is answered by the game that owns it and by nothing else; a game with
 * no `dialog` adapter matches no branch and comes back as NULLs.
 */
const composeLateral = (
  body: (adapter: GameDialogAdapter, ctx: DialogParticipantsSqlContext) => string | undefined,
  recordsAlias: string,
  emptyShape: string,
): string => {
  const branches = dialogAdapterGroups()
    .map(({ adapter, games }) =>
      body(adapter, { records: recordsAlias, gameList: gameListSql(games) }),
    )
    .filter((sql): sql is string => sql != null);

  if (branches.length === 0) return emptyShape;
  if (branches.length === 1) return branches[0]!;
  const union = branches.map((b) => `SELECT * FROM (${b}) AS b`).join(SEPARATOR);
  return `${union}
    LIMIT 1`;
};

/**
 * Build a `LEFT JOIN LATERAL` body resolving both participants of a record.
 *
 * @param recordsAlias - Alias of the `records` row in the enclosing query.
 * @returns SQL to place between `LEFT JOIN LATERAL (` and `) dp ON TRUE`.
 */
export const dialogParticipantsLateralSql = (recordsAlias: string): string =>
  composeLateral((adapter, ctx) => adapter.participantsSql(ctx), recordsAlias, NO_PARTICIPANTS_SQL);

/** Shape of the grid speaker row, for a game with nothing to show. */
const NO_LINE_SPEAKER_SQL = `
    SELECT NULL::text AS display_name, NULL::text AS gender
    WHERE FALSE`;

/**
 * Build a `LEFT JOIN LATERAL` body for the string grid's speaker column.
 *
 * Separate from the participant lookup because the grid asks a different
 * question: not "who is talking to whom in this exchange" but "whose voice is
 * this row, if anyone's" — which for a Creation Engine title also covers a
 * record that merely *names* an actor. Games answer for their own rows; what
 * no game claims falls back to the record's narrator gender.
 *
 * @param recordsAlias - Alias of the `records` row in the enclosing query.
 */
export const lineSpeakerLateralSql = (recordsAlias: string): string =>
  composeLateral((adapter, ctx) => adapter.lineSpeakerSql?.(ctx), recordsAlias, NO_LINE_SPEAKER_SQL);

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
 * @param field - Subrecord the string came from. Some games pack both halves
 * of an exchange into one record and mark the player's half with a field, in
 * which case the roles swap; the game decides, not this function.
 * @param game - Owner of the row, for that decision and for whether the
 * protagonist's gender is fixed or player-chosen.
 */
export const dialogParticipantsFromRow = (
  row: Partial<DialogParticipantsRow>,
  field: string | null | undefined,
  game: GameId | string | null | undefined,
): DialogLineParticipants => {
  const dialog = gamePlugin(game).dialog;
  const isPlayerPrompt = dialog?.isPlayerPromptField(field) ?? false;
  const playerGender = dialog?.playerGender ?? 'any';

  const participants = resolveDialogLineParticipants({
    isPlayerPrompt,
    playerGender,
    nodeSpeakerName: row.speaker_name ?? null,
    nodeSpeakerGender: parseSpeakerGender(row.speaker_gender),
    nodeSpeakerIsPlayer: row.speaker_is_player === true,
    addresseeKind: parseAddresseeKind(row.addressee_kind ?? null),
    addresseeName: row.addressee_name ?? null,
    addresseeGender: parseSpeakerGender(row.addressee_gender),
  });

  if (!isPlayerPrompt) return participants;

  const voiceKeyGender = playerSpeakerGenderFromVoiceKey(row.speaker_key ?? null);
  if (voiceKeyGender == null || !isDefiniteGender(voiceKeyGender)) return participants;

  return { ...participants, speakerGender: voiceKeyGender };
};
