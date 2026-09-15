/** Top-level editor screens a game can offer. */
export type EditorMode = 'strings' | 'dialogs' | 'voice';

/**
 * How the grid renders a record's path column.
 * - `record-path` — Creation Engine `GRUP\FormID\Subrecord` paths, shown verbatim.
 * - `po-key` — gettext `file.po\msgctxt::msgid`, shown as `file.po · key`.
 */
export type RecordPathStyle = 'record-path' | 'po-key';

/**
 * What the editor shows for one game.
 *
 * Decided by the game's plugin on the server, not by the browser: a new game
 * gets the right tabs and columns without any change here.
 */
export type GameEditorProfile = {
  /** Screens shown in the toolbar switch, in order. The first one is the default. */
  modes: EditorMode[];
  columns: {
    formId: boolean;
    signature: boolean;
    gender: boolean;
  };
  actions: {
    genderDetect: boolean;
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

/** A single entry from GET /api/games. */
export type GameInfo = {
  /** Internal game identifier, e.g. `fo4` or `disco`. */
  id: string;
  /** Human-readable title, e.g. "Fallout 4" */
  name: string;
  /** Developer / studio name */
  developer: string;
  /** Original release year */
  releaseYear: number;
  /** NexusMods numeric game ID, used to build the cover image URL. Absent when unlisted. */
  nexusId?: number;
  /**
   * NexusMods URL-safe domain name (e.g. "fallout4").
   * Used as the gameDomainName filter in NexusMods GraphQL requests.
   */
  domainName?: string;
  /** Engine family label */
  engine: string;
  /** Whether the game keeps its text in external string tables */
  localized: boolean;
  /** Extensions accepted as a direct upload, alongside `.zip` / `.7z` / `.rar`. */
  uploadExtensions: string[];
  editor: GameEditorProfile;
};
