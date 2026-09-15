/**
 * What the mod editor shows for a game.
 *
 * The browser used to derive this itself from `gameId === 'disco'`. It is a
 * plugin's job instead: the API serves these flags with the game catalogue and
 * the UI just renders them, so a new game changes no React code.
 */

/** Top-level editor screens a game can offer. */
export type EditorMode = 'strings' | 'dialogs' | 'voice';

/**
 * How the grid renders a record's path column.
 * - `record-path` — Bethesda `GRUP\FormID\Subrecord` paths, shown verbatim.
 * - `po-key` — gettext `file.po\msgctxt::msgid`, shown as `file.po · key`.
 */
export type RecordPathStyle = 'record-path' | 'po-key';

export type GameEditorCapabilities = {
  /** Screens shown in the toolbar switch, in order. The first one is the default. */
  modes: readonly EditorMode[];
  /** Grid columns and side panels that only make sense for some games. */
  columns: {
    formId: boolean;
    signature: boolean;
    gender: boolean;
  };
  /** Actions that depend on data only some games have. */
  actions: {
    /** Offer LLM speaker-gender detection (needs dialogue speaker metadata). */
    genderDetect: boolean;
    /** Link item names to their INNR naming rules (Creation Engine only). */
    innrLink: boolean;
  };
  /** i18n keys under `modEditor.*` for the three grid column headers. */
  labels: {
    signature: string;
    edid: string;
    field: string;
  };
  recordPathStyle: RecordPathStyle;
};
