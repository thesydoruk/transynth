import crypto from 'crypto';

export const sha1Hex = (s: string | Buffer): string => {
  return crypto.createHash('sha1').update(s).digest('hex');
}
