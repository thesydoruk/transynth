/**
 * The one call a synthesis path makes after it wrote a take into a mod: keep a
 * copy in the reference voice store (`referenceVoiceTakes.ts`).
 *
 * A call site knows the mod and the original voice file the take was cloned
 * from; the store wants that file's SHA-1 and the mod's reference game key.
 * Both are resolved here, so a site adds a few lines and nothing can throw
 * back into the synthesis that just succeeded.
 */
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import { log } from '../logger';
import { saveReferenceVoiceTake, type SaveReferenceVoiceTakeOutcome } from './referenceVoiceTakes';
import { resolveVoiceSourceFileHashes, voiceSourceHashMapKey } from './voiceSourceFileHashes';
import { upsertVoiceSynthesisState, type VoiceSynthesisStateRow } from './voiceSynthesisState';

/** What a call site has on hand beyond the stamp it just wrote. */
export type ReferenceVoiceTakeFiles = {
  /** The original take the line was cloned from: its path in the mod and on disk. */
  source: { relPath: string; absPath: string };
  /** The synthesized take as written into the localize directory. */
  takePath: string;
  sourceText?: string | null;
  translation?: string | null;
};

/** The half of {@link ReferenceVoiceTakeFiles} known before the take is written. */
export type VoiceTakeSource = Omit<ReferenceVoiceTakeFiles, 'takePath'>;

export const voiceTakeSource = (
  entry: { relPath: string; absolutePath: string },
  text?: { source?: string | null; translation?: string | null },
): VoiceTakeSource => ({
  source: { relPath: entry.relPath, absPath: entry.absolutePath },
  sourceText: text?.source,
  translation: text?.translation,
});

export type ReferenceVoiceTakeForLine = ReferenceVoiceTakeFiles & {
  modId: number;
  tgtLang: string;
  speakerKey?: string | null;
  ttsTextVersion: string;
  voiceSimilarity?: number | null;
};

const loadModForReference = async (
  db: Tx,
  modId: number,
): Promise<{ name: string; game: string | null } | null> => {
  const { rows } = await db.query<{ name: string; game: string | null }>(
    `SELECT name, game FROM mods WHERE id = $1`,
    [modId],
  );
  return rows[0] ?? null;
};

/**
 * Keep the take a mod's line was just synthesized into. `no-source-hash` when
 * the original file cannot be hashed (missing, or a container row never
 * unpacked) — without it the take has no key. Never throws.
 */
export const saveReferenceVoiceTakeForLine = async (
  db: Tx,
  take: ReferenceVoiceTakeForLine,
): Promise<SaveReferenceVoiceTakeOutcome | 'no-source-hash'> => {
  try {
    const hashes = await resolveVoiceSourceFileHashes(db, [
      { modId: take.modId, relPath: take.source.relPath, absPath: take.source.absPath },
    ]);
    const sourceSha1 = hashes.get(voiceSourceHashMapKey(take.modId, take.source.relPath));
    if (!sourceSha1) return 'no-source-hash';
    const mod = await loadModForReference(db, take.modId);
    if (!mod) return 'failed';
    return await saveReferenceVoiceTake(db, {
      game: mod.game,
      tgtLang: take.tgtLang,
      sourceSha1,
      ttsTextVersion: take.ttsTextVersion,
      takePath: take.takePath,
      speakerKey: take.speakerKey,
      sourceText: take.sourceText,
      translation: take.translation,
      voiceSimilarity: take.voiceSimilarity,
      originModName: mod.name,
    });
  } catch (err) {
    log.warn(
      `Reference voice: could not keep ${take.takePath} (${err instanceof Error ? err.message : String(err)})`,
    );
    return 'failed';
  }
};

const keepStampedTake = (
  db: Tx,
  files: ReferenceVoiceTakeFiles,
  stamp: VoiceSynthesisStateRow,
): Promise<SaveReferenceVoiceTakeOutcome | 'no-source-hash'> =>
  saveReferenceVoiceTakeForLine(db, {
    ...files,
    modId: stamp.modId,
    tgtLang: stamp.targetLang,
    speakerKey: stamp.speakerKey,
    ttsTextVersion: stamp.ttsTextVersion,
    voiceSimilarity: stamp.voiceSimilarity,
  });

/**
 * Record a take just written into a mod: its stamp in `voice_synthesis_state`
 * (which may throw, as before) and a copy in the reference store (which may not).
 */
export const recordVoiceTake = async (
  db: Tx,
  files: ReferenceVoiceTakeFiles,
  stamp: VoiceSynthesisStateRow,
): Promise<void> => {
  await upsertVoiceSynthesisState(db, stamp);
  await keepStampedTake(db, files, stamp);
};

/**
 * The same for a caller that knows the line only by its key — the editor's
 * regenerate flow commits a preview without the source take in hand, so the
 * game's adapter locates it.
 */
export const recordVoiceTakeByLineKey = async (
  db: Tx,
  where: { pluginPath: string; srcLang?: string; takePath: string },
  stamp: VoiceSynthesisStateRow,
): Promise<void> => {
  await upsertVoiceSynthesisState(db, stamp);
  try {
    const mod = await loadModForReference(db, stamp.modId);
    const entry = await gamePlugin(mod?.game).voice?.findLineEntry(db, {
      modId: stamp.modId,
      pluginPath: where.pluginPath,
      lineKey: stamp.lineKey,
      variant: stamp.variant,
      speakerKey: stamp.speakerKey || undefined,
      originPlugin: stamp.originPlugin,
      srcLang: where.srcLang,
      targetLang: stamp.targetLang,
    });
    if (!entry) return;
    await keepStampedTake(db, { ...voiceTakeSource(entry), ...where }, stamp);
  } catch (err) {
    log.warn(
      `Reference voice: could not keep ${where.takePath} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
};
