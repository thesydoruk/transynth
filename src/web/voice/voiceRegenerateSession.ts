/**
 * On-disk state of one voice regeneration review: the attempts synthesized for
 * a line, each kept as the take the game would get plus a WAV the browser can
 * play, until the user picks one or walks away.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../../paths';
import { ensureDir } from '../../utils/file';
import type { VoiceLinePreviewBuild } from '../../games/contract';
import { takeSidecarPath } from '../../voice/takeSidecars';
import type { VoiceRegenerateEffort } from './voiceRegenerateEffort';

export type VoiceRegenerateParams = {
  line_reference: boolean;
};

type VoiceTakeArtifact = Extract<VoiceLinePreviewBuild, { ok: true }>['artifact'];

export type VoiceRegeneratePreviewMeta = {
  id: string;
  attempt: number;
  createdAt: string;
  /** Where the take goes when kept, relative to the localize directory. */
  fuzRel: string;
  payloadVersion: string;
  params: VoiceRegenerateParams;
  artifact?: VoiceTakeArtifact;
  /** Extensions of the files kept beside the take, e.g. `.ffxanim`. */
  sidecars?: string[];
  speakerKey?: string;
  voiceSimilarity?: number | null;
  /** The effort-tag choice the take was made under; absent when none applied. */
  effort?: VoiceRegenerateEffort;
};

export type VoiceRegenerateSessionMeta = {
  modId: number;
  lineKey: string;
  variant: number;
  srcLang: string;
  targetLang: string;
  originPlugin?: string | null;
  previews: VoiceRegeneratePreviewMeta[];
};

export const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PREVIEW_ID_RE = /^[0-9a-f]{12}$/i;

const TAKE_ARTIFACTS: readonly VoiceTakeArtifact[] = ['wav', 'fuz', 'wem'];
/** Sidecar extensions are read back from session JSON; only a plain one is used as a path. */
const SIDECAR_EXTENSION_RE = /^\.[a-z0-9]{1,8}$/;

export const sessionDir = (modId: number, sessionId: string): string =>
  path.join(PATHS.voiceRegenerate, String(modId), sessionId);

const metaPath = (modId: number, sessionId: string): string =>
  path.join(sessionDir(modId, sessionId), 'meta.json');

export const readSessionMeta = (
  modId: number,
  sessionId: string,
): VoiceRegenerateSessionMeta | null => {
  const filePath = metaPath(modId, sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as VoiceRegenerateSessionMeta;
  } catch {
    return null;
  }
};

export const writeSessionMeta = (
  modId: number,
  sessionId: string,
  meta: VoiceRegenerateSessionMeta,
): void => {
  const dir = sessionDir(modId, sessionId);
  ensureDir(dir);
  fs.writeFileSync(metaPath(modId, sessionId), JSON.stringify(meta, null, 2));
};

/** The take file a preview was stored as. Sessions written before `artifact` existed hold a `.fuz`. */
export const previewArtifact = (preview: VoiceRegeneratePreviewMeta): VoiceTakeArtifact =>
  preview.artifact && TAKE_ARTIFACTS.includes(preview.artifact) ? preview.artifact : 'fuz';

const previewTakePath = (dir: string, previewId: string, artifact: VoiceTakeArtifact): string =>
  path.join(dir, `${previewId}.${artifact}`);

/**
 * Store a built preview in the session: the take, and its sidecars beside it.
 * Returns the take's path and the sidecar extensions to remember.
 */
export const writePreviewTake = (
  dir: string,
  previewId: string,
  built: Extract<VoiceLinePreviewBuild, { ok: true }>,
): { takePath: string; sidecars: string[] } => {
  const takePath = previewTakePath(dir, previewId, built.artifact);
  fs.writeFileSync(takePath, built.audio);
  const sidecars = built.sidecars ?? [];
  for (const sidecar of sidecars) {
    fs.writeFileSync(takeSidecarPath(takePath, sidecar.extension), sidecar.data);
  }
  return { takePath, sidecars: sidecars.map((sidecar) => sidecar.extension) };
};

/**
 * Copy a stored preview to where the mod keeps the take, sidecars included.
 * False when the preview's take is no longer in the session.
 */
export const commitPreviewTake = (
  dir: string,
  preview: VoiceRegeneratePreviewMeta,
  destPath: string,
): boolean => {
  const takePath = previewTakePath(dir, preview.id, previewArtifact(preview));
  if (!fs.existsSync(takePath)) return false;
  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, fs.readFileSync(takePath));
  for (const extension of preview.sidecars ?? []) {
    if (!SIDECAR_EXTENSION_RE.test(extension)) continue;
    const sidecar = takeSidecarPath(takePath, extension);
    if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, takeSidecarPath(destPath, extension));
  }
  return true;
};

/** Stream a temporary preview WAV for browser playback. */
export const getVoiceRegeneratePreviewWav = (
  modId: number,
  sessionId: string,
  previewId: string,
): { ok: true; wavPath: string } | { ok: false; reason: string; message: string } => {
  if (!SESSION_ID_RE.test(sessionId) || !PREVIEW_ID_RE.test(previewId)) {
    return { ok: false, reason: 'invalid_id', message: 'Invalid session or preview id' };
  }

  const wavPath = path.join(sessionDir(modId, sessionId), `${previewId}.wav`);
  if (!fs.existsSync(wavPath)) {
    return { ok: false, reason: 'preview_not_found', message: 'Preview audio not found' };
  }
  return { ok: true, wavPath };
};

/** Delete a regeneration session and all temporary preview files. */
export const discardVoiceRegenerateSession = (modId: number, sessionId: string): void => {
  if (!SESSION_ID_RE.test(sessionId)) return;
  const dir = sessionDir(modId, sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** List previews in an active session (for UI restore after reload). */
export const listVoiceRegenerateSession = (
  modId: number,
  sessionId: string,
): VoiceRegenerateSessionMeta | null => readSessionMeta(modId, sessionId);
