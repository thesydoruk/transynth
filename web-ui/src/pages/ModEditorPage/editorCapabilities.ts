import type { EditorPageMode } from './components/EditorToolbar/EditorModeSwitch';

/** Editor UX profile for a game (Bethesda vs Disco Final Cut packs). */
export type EditorCapabilities = {
  gameId: string;
  isDisco: boolean;
  /** Modes shown in the toolbar switch. */
  modes: EditorPageMode[];
  showDialogsMode: boolean;
  showVoiceMode: boolean;
  showSignaturePanel: boolean;
  showFormIdColumn: boolean;
  showGenderColumn: boolean;
  showGenderDetect: boolean;
  showInnrLink: boolean;
  /** Grid column label keys under `modEditor.*`. */
  labels: {
    signature: string;
    edid: string;
    field: string;
  };
};

const BETHESDA_MODES: EditorPageMode[] = ['strings', 'dialogs', 'voice'];
const DISCO_MODES: EditorPageMode[] = ['strings', 'voice'];

/** Resolve editor capabilities from the route/mod game id. */
export const editorCapabilities = (gameId: string | undefined | null): EditorCapabilities => {
  const id = (gameId ?? 'fo4').toLowerCase();
  const isDisco = id === 'disco';

  if (isDisco) {
    return {
      gameId: id,
      isDisco: true,
      modes: DISCO_MODES,
      showDialogsMode: false,
      showVoiceMode: true,
      showSignaturePanel: true,
      showFormIdColumn: false,
      showGenderColumn: false,
      showGenderDetect: false,
      showInnrLink: false,
      labels: {
        signature: 'discoType',
        edid: 'discoAudio',
        field: 'discoKey',
      },
    };
  }

  return {
    gameId: id,
    isDisco: false,
    modes: BETHESDA_MODES,
    showDialogsMode: true,
    showVoiceMode: true,
    showSignaturePanel: true,
    showFormIdColumn: true,
    showGenderColumn: true,
    showGenderDetect: true,
    showInnrLink: true,
    labels: {
      signature: 'grup',
      edid: 'edid',
      field: 'field',
    },
  };
};

/** Clamp a persisted/URL mode to what the game supports. */
export const clampEditorPageMode = (
  mode: EditorPageMode,
  caps: EditorCapabilities,
): EditorPageMode => (caps.modes.includes(mode) ? mode : 'strings');

/**
 * Display key for a Disco PO path: `Dialogues.po · msgctxt::msgid`
 * from `PO\Dialogues.po\msgctxt::msgid`.
 */
export const formatDiscoPoKey = (path: string | null | undefined): string => {
  if (!path) return '';
  const normalized = path.replace(/\//g, '\\');
  const rest = normalized.replace(/^PO\\/i, '');
  const sep = rest.indexOf('\\');
  if (sep < 0) return rest;
  const file = rest.slice(0, sep);
  const key = rest.slice(sep + 1);
  return key ? `${file} · ${key}` : file;
};
