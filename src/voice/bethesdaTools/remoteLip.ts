import fs from 'node:fs';
import { postBethesdaToolBinary } from './client';

/** Raw dialogue. Sidecar picks Ukrainian vs USEnglish; FaceFXWrapper 0.51+ respells. */
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
