import fs from 'node:fs';
import { postBethesdaToolBinary } from './client';

/** Text must already be prepared (`prepareFaceFxDialogueText`); the sidecar does not respell. */
export const generateLipViaRemote = async (
  baseUrl: string,
  game: string,
  sourceWavPath: string,
  lipPath: string,
  dialogueText: string,
): Promise<void> => {
  const wav = fs.readFileSync(sourceWavPath);
  const lip = await postBethesdaToolBinary(baseUrl, '/v1/lip', {
    game,
    text: dialogueText,
    wav: wav.toString('base64'),
  });
  fs.writeFileSync(lipPath, lip);
};
