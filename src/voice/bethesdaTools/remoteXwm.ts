import fs from 'node:fs';
import { postBethesdaToolBinary } from './client';

export const encodeXwmViaRemote = async (
  baseUrl: string,
  wavPath: string,
  xwmPath: string,
): Promise<void> => {
  const wav = fs.readFileSync(wavPath);
  const xwm = await postBethesdaToolBinary(baseUrl, '/v1/xwm', {
    wav: wav.toString('base64'),
  });
  fs.writeFileSync(xwmPath, xwm);
};
