import crypto from 'crypto';

export function sha1Hex(s: string | Buffer): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}
