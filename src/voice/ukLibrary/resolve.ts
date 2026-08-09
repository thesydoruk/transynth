import fs from 'node:fs';
import type { Tx } from '../../db';
import { getCharacterUkVoiceLink, getUkVoiceById } from './db';
import { ukVoiceAudioAbsPath } from './paths';

export type ResolvedUkLibraryReference = {
  voiceId: string;
  wavPath: string;
  transcript: string;
  displayName: string;
};

/**
 * Resolve a global Ukrainian library reference for a voice-folder character.
 *
 * Returns null when the character has no link — callers then keep the normal
 * pipeline (line reference, or auto speaker reference when the line is short).
 * Robots are not special-cased: a link works the same as for any folder.
 */
export const resolveUkLibraryReference = async (
  db: Tx,
  characterKey: string,
): Promise<ResolvedUkLibraryReference | null> => {
  const trimmed = characterKey.trim();
  if (!trimmed) return null;

  const link = await getCharacterUkVoiceLink(db, trimmed);
  if (!link) return null;

  const voice = await getUkVoiceById(db, link.voiceId);
  if (!voice) return null;

  const wavPath = ukVoiceAudioAbsPath(voice.audioRelPath);
  if (!fs.existsSync(wavPath)) return null;

  return {
    voiceId: voice.id,
    wavPath,
    transcript: voice.transcript,
    displayName: voice.displayName,
  };
};
