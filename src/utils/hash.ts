/**
 * Cryptographic hashing utilities.
 */
import crypto from 'crypto';
import fs from 'node:fs';

/**
 * Compute the SHA-1 digest of a string or binary buffer.
 *
 * Used for deduplication keys (record hash, string hash) throughout the import
 * pipeline. SHA-1 is intentionally chosen over SHA-256 for compactness; it is
 * not used for any security-sensitive purpose.
 *
 * @param s - Input string (UTF-8) or raw binary Buffer.
 * @returns 40-character lowercase hex digest.
 */
export const sha1Hex = (s: string | Buffer): string => {
  return crypto.createHash('sha1').update(s).digest('hex');
};

/** Stream a file from disk and return its SHA-1 hex digest (network-friendly). */
export const sha1HexFile = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};
