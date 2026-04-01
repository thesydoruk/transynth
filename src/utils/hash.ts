/**
 * Cryptographic hashing utilities.
 */
import crypto from 'crypto';

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
}
