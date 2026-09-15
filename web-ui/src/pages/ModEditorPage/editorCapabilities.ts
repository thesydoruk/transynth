import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import type { GameEditorProfile } from '../../api/types/games';
import type { EditorPageMode } from './components/EditorToolbar/EditorModeSwitch';

/**
 * The editor's per-game profile.
 *
 * The server decides it — each game plugin declares which screens, columns and
 * actions its mods get — so nothing here knows the name of any game.
 */
export type EditorCapabilities = GameEditorProfile & {
  gameId: string;
  /**
   * True when a row is addressed by a record path (`GRUP\FormID\Subrecord`)
   * rather than a gettext key. Record paths come with FormIDs, editor IDs,
   * speaker context and compiled scripts; gettext keys come with none of that.
   */
  usesRecordPaths: boolean;
};

/**
 * Profile used until the catalogue arrives, and for a game the server does not
 * know. Deliberately permissive: hiding a tab for a moment and then showing it
 * is worse than showing one that turns out to be empty.
 */
const PERMISSIVE_PROFILE: GameEditorProfile = {
  modes: ['strings', 'dialogs', 'voice'],
  columns: { formId: true, signature: true, gender: true },
  actions: { genderDetect: true, innrLink: true },
  labels: { signature: 'grup', edid: 'edid', field: 'field' },
  recordPathStyle: 'record-path',
};

const toCapabilities = (gameId: string, profile: GameEditorProfile): EditorCapabilities => ({
  ...profile,
  gameId,
  usesRecordPaths: profile.recordPathStyle === 'record-path',
});

/** Resolve editor capabilities for a game from the cached `/api/games` catalogue. */
export const useEditorCapabilities = (gameId: string | undefined | null): EditorCapabilities => {
  const { data: games } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: 60_000,
  });

  const id = (gameId ?? '').toLowerCase();
  const profile = games?.find((game) => game.id === id)?.editor ?? PERMISSIVE_PROFILE;
  return toCapabilities(id, profile);
};

/** Capabilities for a component rendered without a known game (previews, tests). */
export const defaultEditorCapabilities = (gameId = ''): EditorCapabilities =>
  toCapabilities(gameId, PERMISSIVE_PROFILE);

/** Clamp a persisted/URL mode to what the game supports. */
export const clampEditorPageMode = (
  mode: EditorPageMode,
  caps: EditorCapabilities,
): EditorPageMode => (caps.modes.includes(mode) ? mode : 'strings');

/**
 * Display key for a gettext row path: `Dialogues.po · msgctxt::msgid`
 * from `PO\Dialogues.po\msgctxt::msgid`.
 */
export const formatPoKey = (path: string | null | undefined): string => {
  if (!path) return '';
  const normalized = path.replace(/\//g, '\\');
  const rest = normalized.replace(/^PO\\/i, '');
  const sep = rest.indexOf('\\');
  if (sep < 0) return rest;
  const file = rest.slice(0, sep);
  const key = rest.slice(sep + 1);
  return key ? `${file} · ${key}` : file;
};

/** The row's field column: a gettext key, or the last segment of a record path. */
export const formatRowFieldLabel = (
  path: string | null | undefined,
  caps: EditorCapabilities,
): string => (caps.usesRecordPaths ? (path?.split('\\').pop() ?? '') : formatPoKey(path));
