import crypto from 'crypto';

export function sha1Hex(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}
