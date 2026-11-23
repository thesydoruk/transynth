import path from 'node:path';
import crypto from 'node:crypto';
import type { Tx } from '../../db';
import { ensureDir } from '../../utils/file';
import { toDiskPath, resolveImportPackages } from '../../modImport';
import { modImportLocalizeDir, resolveModImportExtractRoot } from '../../modStorage';
import { loadImportedMod } from '../../modImport/importedMod';
import { gamePlugin } from '../../games/registry';
import { speakerKeyFromVoiceRelPath } from '../../voice/voiceSynthesisState';
import { originFromVoiceRelPath } from '../../voice/voiceOrigin';
import { recordVoiceTakeByLineKey } from '../../voice/referenceVoiceTakeHooks';
import { getAllProjectSettings } from '../services/projectSettings';
import { convertAudioToPreviewWav } from './preview/audioCache';
import { resolveModVoiceContext } from './preview';
import {
  commitPreviewTake,
  discardVoiceRegenerateSession,
  PREVIEW_ID_RE,
  previewArtifact,
  readSessionMeta,
  SESSION_ID_RE,
  sessionDir,
  writePreviewTake,
  writeSessionMeta,
  type VoiceRegenerateParams,
  type VoiceRegeneratePreviewMeta,
} from './voiceRegenerateSession';

export {
  discardVoiceRegenerateSession,
  getVoiceRegeneratePreviewWav,
  listVoiceRegenerateSession,
  type VoiceRegenerateParams,
} from './voiceRegenerateSession';

const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';

export type VoiceRegeneratePreviewResult =
  | {
      ok: true;
      previewId: string;
      attempt: number;
      audioUrl: string;
      params: VoiceRegenerateParams;
      voiceSimilarity: number | null;
    }
  | { ok: false; reason: string; message: string };

export type VoiceRegenerateCommitResult =
  | { ok: true; relPath: string; kept: 'original' | 'preview' }
  | { ok: false; reason: string; message: string };

const voiceRegenerateParamsFromProjectSettings = async (db: Tx): Promise<VoiceRegenerateParams> => {
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
  lineKey: string,
  variant: number,
  srcLang: string,
  targetLang: string,
  originPlugin?: string | null,
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
    lineKey,
    variant,
    srcLang,
    targetLang,
    originPlugin: originPlugin || null,
    previews: [],
  });

  return { ok: true, defaultParams };
};

/** Synthesize one preview attempt with custom parameters (stored under session). */
export const generateVoiceRegeneratePreview = async (
  db: Tx,
  modId: number,
  sessionId: string,
  lineKey: string,
  variant: number,
  srcLang: string,
  targetLang: string,
  params: VoiceRegenerateParams,
  speakerKey?: string,
  originPlugin?: string | null,
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
      lineKey,
      variant,
      srcLang,
      targetLang,
      originPlugin,
    );
    if (!init.ok) return init;
    meta = readSessionMeta(modId, sessionId);
  }
  if (!meta) {
    return { ok: false, reason: 'session_missing', message: 'Regeneration session not found' };
  }

  if (meta.lineKey.toUpperCase() !== lineKey.toUpperCase() || meta.variant !== variant) {
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

  const voice = gamePlugin(mod.game).voice;
  if (!voice) {
    return { ok: false, reason: 'session_missing', message: 'This game has no voice support' };
  }

  const built = await voice.buildLinePreview(db, {
    modId,
    packageDir: resolved.ctx.packageDir,
    pluginPath: resolved.ctx.pluginPath,
    lineKey,
    variant,
    srcLang,
    tgtLang: targetLang,
    referenceMode,
    speakerKey,
    originPlugin: originPlugin || meta.originPlugin || null,
  });
  if (!built.ok) return built;

  const { destRelPath: destRel, payloadVersion, artifact, speakerKey: previewSpeakerKey } = built;
  const voiceSimilarity = built.voiceSimilarity;

  const stored = writePreviewTake(dir, previewId, built);
  if (built.artifact !== 'wav') {
    // The browser cannot play a `.fuz` or a `.wem`; keep the real take and serve a WAV copy.
    const takePath = stored.takePath;
    try {
      await convertAudioToPreviewWav(takePath, wavPath);
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
    ...(stored.sidecars.length > 0 ? { sidecars: stored.sidecars } : {}),
    speakerKey: previewSpeakerKey ?? speakerKey,
    voiceSimilarity,
  };
  meta.previews.push(previewMeta);
  writeSessionMeta(modId, sessionId, meta);

  return {
    ok: true,
    previewId,
    attempt,
    audioUrl: `/api/mods/${modId}/voice/regenerate/${sessionId}/${previewId}.wav`,
    params,
    voiceSimilarity,
  };
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

  const destPath = toDiskPath(localizeDir, preview.fuzRel);
  if (!commitPreviewTake(sessionDir(modId, sessionId), preview, destPath)) {
    return {
      ok: false,
      reason: 'preview_not_found',
      message: `Preview ${previewArtifact(preview).toUpperCase()} not found`,
    };
  }

  const take = { pluginPath: resolved.ctx.pluginPath, srcLang: meta.srcLang, takePath: destPath };
  await recordVoiceTakeByLineKey(db, take, {
    modId,
    lineKey: meta.lineKey,
    variant: meta.variant,
    speakerKey: preview.speakerKey?.trim() || speakerKeyFromVoiceRelPath(preview.fuzRel),
    originPlugin: originFromVoiceRelPath(preview.fuzRel) ?? '',
    targetLang: meta.targetLang,
    ttsTextVersion: preview.payloadVersion,
    voiceSimilarity: preview.voiceSimilarity,
  });

  const relPath = preview.fuzRel;
  discardVoiceRegenerateSession(modId, sessionId);
  return { ok: true, relPath, kept: 'preview' };
};
