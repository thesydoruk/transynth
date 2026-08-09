import fs from 'node:fs';
import path from 'node:path';
import { parseCvAge, type UkVoiceAge } from '../ageBand';
import { parseCvGender } from './clientId';

export type CvTsvClip = {
  clientId: string;
  path: string;
  sentence: string;
  upVotes: number;
  gender: 'male' | 'female' | 'unknown';
  age: UkVoiceAge;
};

const splitTsvLine = (line: string): string[] => line.split('\t');

/** Parse Common Voice validated.tsv into clip rows keyed later by client_id. */
export const parseValidatedTsv = (tsvPath: string): CvTsvClip[] => {
  const text = fs.readFileSync(tsvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const header = splitTsvLine(lines[0]!);
  const idx = (name: string): number => header.indexOf(name);

  const iClient = idx('client_id');
  const iPath = idx('path');
  const iSentence = idx('sentence');
  const iUp = idx('up_votes');
  const iGender = idx('gender');
  const iAge = idx('age');
  if (iClient < 0 || iPath < 0 || iSentence < 0) {
    throw new Error(`validated.tsv missing required columns: ${header.join(',')}`);
  }

  const clips: CvTsvClip[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitTsvLine(lines[i]!);
    const clientId = cols[iClient]?.trim();
    const clipPath = cols[iPath]?.trim();
    const sentence = cols[iSentence]?.trim();
    if (!clientId || !clipPath || !sentence) continue;
    clips.push({
      clientId,
      path: clipPath,
      sentence,
      upVotes: iUp >= 0 ? Number(cols[iUp] ?? 0) || 0 : 0,
      gender: parseCvGender(iGender >= 0 ? cols[iGender] : null),
      age: parseCvAge(iAge >= 0 ? cols[iAge] : null),
    });
  }
  return clips;
};

/** Resolve clip path relative to the directory that contains validated.tsv (usually …/uk/). */
export const resolveCvClipPath = (tsvPath: string, relativeClip: string): string => {
  const localeDir = path.dirname(tsvPath);
  const direct = path.join(localeDir, 'clips', relativeClip);
  if (fs.existsSync(direct)) return direct;
  const alt = path.join(localeDir, relativeClip);
  if (fs.existsSync(alt)) return alt;
  return direct;
};
