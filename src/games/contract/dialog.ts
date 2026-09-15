import type { SpeakerGender } from '../../dialog/gender';
import type { GameId } from '../../types';

/** Aliases the enclosing query exposes to a participant lookup. */
export type DialogParticipantsSqlContext = {
  /** Alias of the `records` row, e.g. `r`. */
  records: string;
  /**
   * SQL literal list of the game ids this adapter answers for, ready to drop
   * into `IN (…)`. The shared builder quotes them; an adapter must use it, or
   * its branch will claim another game's rows.
   */
  gameList: string;
};

/**
 * How one game answers "who says this line, and to whom".
 *
 * Every stage that writes Ukrainian needs both participants and their gender,
 * and every game records them somewhere different: a Creation Engine title in
 * its INFO/DIAL graph keyed by FormID, Disco Elysium in the `.wav` stem beside
 * a `.po` entry. What they have in common is only the answer, so the answer is
 * the contract and the lookup is the game's own.
 *
 * A game with no spoken dialogue leaves `dialog` unset on its plugin; its lines
 * then resolve to no participants at all, which downstream reads as "not a
 * dialogue line" rather than "a line whose speaker we failed to find".
 */
export type GameDialogAdapter = {
  /**
   * Grammatical gender of the protagonist.
   *
   * `any` when the player picks it at character creation, as every Bethesda
   * title does — a line they speak then has to read correctly either way.
   * A game with a written protagonist says which: Disco Elysium's Harry is
   * male, and hedging his lines would be a mistranslation, not caution.
   */
  playerGender: SpeakerGender;

  /**
   * Is a record with this signature a line somebody speaks aloud?
   *
   * Decides whether the LLM payload names an addressee. Note this is asked of
   * records whose speaker could not be resolved too: a line that is spoken but
   * unattributed still has to be phrased so no gender shows, and the model is
   * only told that when it knows the line is dialogue.
   */
  isSpokenSignature(signature: string | null | undefined): boolean;

  /**
   * Is this field the player's own line rather than what they are answering?
   *
   * Creation Engine packs both halves of an exchange into one INFO record —
   * `RNAM` is the prompt the player picks, everything else is the NPC reply —
   * so the roles swap on this field alone. A game that stores the two halves as
   * separate records never says yes here.
   */
  isPlayerPromptField(field: string | null | undefined): boolean;

  /**
   * A `SELECT` resolving both participants of one record.
   *
   * Must produce exactly the columns of `DialogParticipantsRow`, and must
   * restrict itself to its own games — the shared builder joins every game's
   * lookup into one lateral, so an unguarded branch answers for rows it knows
   * nothing about. Return at most one row.
   */
  participantsSql(ctx: DialogParticipantsSqlContext): string;

  /**
   * A `SELECT` of `display_name, gender` for the string grid's speaker column.
   *
   * A different question from {@link participantsSql}: not who is talking to
   * whom, but whose voice a row is at all — which for a Creation Engine title
   * also covers a record that merely *names* an actor, where the translator
   * needs the actor's gender to render the name. Same rules as the participant
   * lookup: guard to your own games, return at most one row. Leave it out and
   * the grid falls back to the record's narrator gender.
   */
  lineSpeakerSql?(ctx: DialogParticipantsSqlContext): string;
};

/** Game ids grouped by the dialog adapter they share, for the lateral builder. */
export type DialogAdapterGroup = {
  adapter: GameDialogAdapter;
  games: readonly GameId[];
};
