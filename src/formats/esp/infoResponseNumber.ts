/**
 * The number an INFO response declares for itself.
 *
 * Fallout 4 and Skyrim name a voice file `<FormID>_<responseNumber>.fuz`, and
 * the number is the uint32 at offset 4 of the response's 20-byte `TRDA` — not
 * the position of the response in its INFO. Starfield's `TRDA` is a different,
 * 12-byte struct with no number; there the caller falls back to the 1-based
 * position of the response's `NAM1`.
 */

/** Size of a `TRDA` that carries a response number. */
const NUMBERED_TRDA_SIZE = 20;

/**
 * Upper bound for a plausible response number, only to reject misaligned reads.
 *
 * Bethesda writers assign these by hand and vanilla `Fallout4.esm` goes well past
 * the response count — e.g. INFO `001505FB` uses 1, 102, 103, 104, 105, matching
 * `001505FB_102.fuz` … `_105.fuz`. A tight bound silently dropped those numbers,
 * fell back to the NAM1 ordinal, and left the audio unmatched.
 */
const MAX_RESPONSE_NUMBER = 9999;

/**
 * Response number of the `TRDA` payload at `[start, end)`, or null when the
 * struct carries none and the response's position is its number.
 */
export const readInfoResponseNumber = (data: Buffer, start: number, end: number): number | null => {
  if (end - start < NUMBERED_TRDA_SIZE) return null;
  const raw = data.readUInt32LE(start + 4);
  return raw >= 1 && raw <= MAX_RESPONSE_NUMBER ? raw : null;
};
