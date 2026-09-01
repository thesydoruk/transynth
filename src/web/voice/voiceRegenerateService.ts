import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Tx } from '../../db';
import { PATHS } from '../../paths';
import { ensureDir } from '../../utils/file';
import { toDiskPath, resolveImportPackages } from '../../modImport';
import { modImportLocalizeDir, resolveModImportExtractRoot } from '../../modStorage';
import { loadImportedMod } from '../../modImport/importedMod';
import { synthesizeDiscoVoiceLineBuffers } from '../../voice/disco/synthesizeDiscoVoiceLine';
import {
  synthesizeModVoiceLineBuffers,
  type SynthesizeModVoiceLineOptions,
} from '../../voice/synthesizeModVoiceLine';
import {
  speakerKeyFromVoiceRelPath,
  upsertVoiceSynthesisState,
} from '../../voice/voiceSynthesisState';
import { getAllProjectSettings } from '../services/projectSettings';
import { convertAudioToPreviewWav } from './preview/audioCache';
import { resolveModVoiceContext } from './preview';

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';

/** Keep the current saved translation without applying a preview. */
export const VOICE_REGENERATE_ORIGINAL_ID = VOICE_REGENERATE_KEEP_CURRENT_ID;

export type VoiceRegenerateParams = {
  line_reference: boolean;
};

type VoiceRegeneratePreviewMeta = {
  id: string;
  attempt: number;
  createdAt: string;
  fuzRel: string;
  payloadVersion: string;
  params: VoiceRegenerateParams;
  artifact?: 'fuz' | 'wav';
  speakerKey?: string;
};

type VoiceRegenerateSessionMeta = {
  modId: number;
  formidLower6: string;
  variant: number;
  srcLang: string;
  targetLang: string;
  previews: VoiceRegeneratePreviewMeta[];
};

export type VoiceRegeneratePreviewResult =
  | {
      ok: true;
      previewId: string;
      attempt: number;
      audioUrl: string;
      params: VoiceRegenerateParams;
    }
  | { ok: false; reason: string; message: string };

export type VoiceRegenerateCommitResult =
  | { ok: true; relPath: string; kept: 'original' | 'preview' }
  | { ok: false; reason: string; message: string };

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_ID_RE = /^[0-9a-f]{12}$/i;

const sessionDir = (modId: number, sessionId: string): string =>
  path.join(PATHS.voiceRegenerate, String(modId), sessionId);

const metaPath = (modId: number, sessionId: string): string =>
  path.join(sessionDir(modId, sessionId), 'meta.json');

const readSessionMeta = (modId: number, sessionId: string): VoiceRegenerateSessionMeta | null => {
  const filePath = metaPath(modId, sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as VoiceRegenerateSessionMeta;
  } catch {
    return null;
  }
};

const writeSessionMeta = (
  modId: number,
  sessionId: string,
  meta: VoiceRegenerateSessionMeta,
): void => {
  const dir = sessionDir(modId, sessionId);
  ensureDir(dir);
  fs.writeFileSync(metaPath(modId, sessionId), JSON.stringify(meta, null, 2));
};

export const voiceRegenerateParamsFromProjectSettings = async (
  db: Tx,
): Promise<VoiceRegenerateParams> => {
  const settings = await getAllProjectSettings(db);
  return {
    line_reference: settings['voice.line_reference'],
  };
};

/** Create a new regeneration session for one voice line. */
export const initVoiceRegenerateSession = async (
  db: Tx,
  modId: number,
  sessionId: string,
  formidLower6: string,
  variant: number,
  srcLang: string,
  targetLang: string,
): Promise<
  | { ok: true; defaultParams: VoiceRegenerateParams }
  | { ok: false; reason: string; message: string }
> => {
  if (!SESSION_ID_RE.test(sessionId)) {
    return { ok: false, reason: 'invalid_session', message: 'Invalid session id' };
  }

  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const defaultParams = await voiceRegenerateParamsFromProjectSettings(db);
  writeSessionMeta(modId, sessionId, {
    modId,
    formidLower6,
    variant,
    srcLang,
    targetLang,
    previews: [],
  });

  return { ok: true, defaultParams };
};

/** Synthesize one preview attempt with custom parameters (stored under session). */
export const generateVoiceRegeneratePreview = async (
  db: Tx,
  modId: number,
  sessionId: string,
  formidLower6: string,
  variant: number,
  srcLang: string,
  targetLang: string,
  params: VoiceRegenerateParams,
  speakerKey?: string,
): Promise<VoiceRegeneratePreviewResult> => {
  if (!SESSION_ID_RE.test(sessionId)) {
    return { ok: false, reason: 'invalid_session', message: 'Invalid session id' };
  }

  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  let meta = readSessionMeta(modId, sessionId);
  if (!meta) {
    const init = await initVoiceRegenerateSession(
      db,
      modId,
      sessionId,
      formidLower6,
      variant,
      srcLang,
      targetLang,
    );
    if (!init.ok) return init;
    meta = readSessionMeta(modId, sessionId);
  }
  if (!meta) {
    return { ok: false, reason: 'session_missing', message: 'Regeneration session not found' };
  }

  if (meta.formidLower6.toUpperCase() !== formidLower6.toUpperCase() || meta.variant !== variant) {
    return {
      ok: false,
      reason: 'session_mismatch',
      message: 'Session belongs to a different voice line',
    };
  }

  const mod = await loadImportedMod(db, modId);
  const referenceMode = params.line_reference ? 'line' : 'speaker';
  const previewId = crypto.randomBytes(6).toString('hex');
  const attempt = meta.previews.length + 1;
  const dir = sessionDir(modId, sessionId);
  ensureDir(dir);
  const wavPath = path.join(dir, `${previewId}.wav`);

  let destRel: string;
  let payloadVersion: string;
  let artifact: 'fuz' | 'wav';
  let previewSpeakerKey: string | undefined;

  if (mod.game === 'disco') {
    const built = await synthesizeDiscoVoiceLineBuffers(db, {
      modId,
      pluginPath: resolved.ctx.pluginPath,
      formidLower6,
      variant,
      srcLang,
      tgtLang: targetLang,
      referenceMode,
    });
    if (!built.ok) return built;
    destRel = built.wavRel;
    payloadVersion = built.payloadVersion;
    artifact = 'wav';
    previewSpeakerKey = built.speakerKey;
    fs.writeFileSync(wavPath, built.ttsWav);
  } else {
    const built = await synthesizeModVoiceLineBuffers(db, {
      modId,
      packageDir: resolved.ctx.packageDir,
      pluginPath: resolved.ctx.pluginPath,
      formidLower6,
      variant,
      srcLang,
      tgtLang: targetLang,
      referenceMode,
      speakerKey,
    } satisfies SynthesizeModVoiceLineOptions);
    if (!built.ok) return built;
    destRel = built.fuzRel;
    payloadVersion = built.payloadVersion;
    artifact = 'fuz';
    const fuzPath = path.join(dir, `${previewId}.fuz`);
    fs.writeFileSync(fuzPath, built.fuzData);
    try {
      await convertAudioToPreviewWav(fuzPath, wavPath);
    } catch (err) {
      return {
        ok: false,
        reason: 'preview_convert_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const previewMeta: VoiceRegeneratePreviewMeta = {
    id: previewId,
    attempt,
    createdAt: new Date().toISOString(),
    fuzRel: destRel,
    payloadVersion,
    params,
    artifact,
    speakerKey: previewSpeakerKey ?? speakerKey,
  };
  meta.previews.push(previewMeta);
  writeSessionMeta(modId, sessionId, meta);

  return {
    ok: true,
    previewId,
    attempt,
    audioUrl: `/api/mods/${modId}/voice/regenerate/${sessionId}/${previewId}.wav`,
    params,
  };
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

/** Keep the selected preview (or original) and discard the session. */
export const commitVoiceRegenerateSession = async (
  db: Tx,
  modId: number,
  sessionId: string,
  previewId: string,
): Promise<VoiceRegenerateCommitResult> => {
  if (!SESSION_ID_RE.test(sessionId)) {
    return { ok: false, reason: 'invalid_session', message: 'Invalid session id' };
  }

  const meta = readSessionMeta(modId, sessionId);
  if (!meta) {
    return { ok: false, reason: 'session_missing', message: 'Regeneration session not found' };
  }

  if (previewId === VOICE_REGENERATE_KEEP_CURRENT_ID) {
    discardVoiceRegenerateSession(modId, sessionId);
    return { ok: true, relPath: '', kept: 'original' };
  }

  if (!PREVIEW_ID_RE.test(previewId)) {
    return { ok: false, reason: 'invalid_preview', message: 'Invalid preview id' };
  }

  const preview = meta.previews.find((entry) => entry.id === previewId);
  if (!preview) {
    return { ok: false, reason: 'preview_not_found', message: 'Preview not found in session' };
  }

  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const extractRoot = resolveModImportExtractRoot(resolved.ctx.pluginPath);
  if (!extractRoot) {
    return {
      ok: false,
      reason: 'no_localize_dir',
      message: 'Mod import localize directory not found',
    };
  }

  const packages = resolveImportPackages(extractRoot, resolved.targetLang, resolved.ctx.pluginPath);
  const localizeDir =
    packages[0]?.localizeDir ?? modImportLocalizeDir(extractRoot, resolved.targetLang);
  ensureDir(localizeDir);

  const artifact = preview.artifact === 'wav' ? 'wav' : 'fuz';
  const artifactPath = path.join(sessionDir(modId, sessionId), `${previewId}.${artifact}`);
  if (!fs.existsSync(artifactPath)) {
    return {
      ok: false,
      reason: 'preview_not_found',
      message: artifact === 'wav' ? 'Preview WAV not found' : 'Preview FUZ not found',
    };
  }

  const destPath = toDiskPath(localizeDir, preview.fuzRel);
  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, fs.readFileSync(artifactPath));

  await upsertVoiceSynthesisState(db, {
    modId,
    formidLower6: meta.formidLower6,
    variant: meta.variant,
    speakerKey: preview.speakerKey?.trim() || speakerKeyFromVoiceRelPath(preview.fuzRel),
    targetLang: meta.targetLang,
    ttsTextVersion: preview.payloadVersion,
  });

  const relPath = preview.fuzRel;
  discardVoiceRegenerateSession(modId, sessionId);
  return { ok: true, relPath, kept: 'preview' };
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
