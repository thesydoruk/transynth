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
 * Resolve the global voice reference (open UA library) for a voice-folder character.
 *
 * Returns null when the character has no link — callers then use only the local
 * voice reference (same-line game audio, or a selected-line clip when short).
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
