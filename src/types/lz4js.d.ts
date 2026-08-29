/**
 * Minimal type declarations for the lz4js pure-JS LZ4 codec package.
 * The package ships no @types definition; this file satisfies TypeScript's
 * declaration requirement so that the compiler does not emit TS7016 errors.
 */
declare module 'lz4js' {
  /**
   * Decompress an LZ4 block from `src` into `dest`.
   *
   * @param src    - Input buffer containing LZ4-compressed data.
   * @param dest   - Pre-allocated output buffer large enough to hold the result.
   * @param sIdx   - Optional start index in `src` (default 0).
   * @param eIdx   - Optional end index in `src` (default src.length).
   * @param dIdx   - Optional start index in `dest` (default 0).
   * @returns The number of bytes written into `dest`.
   */
  function decompress(
    src: Uint8Array,
    dest: Uint8Array,
    sIdx?: number,
    eIdx?: number,
    dIdx?: number,
  ): number;

  /**
   * Compress `src` into `dest` using LZ4 block format.
   *
   * @param src  - Input buffer.
   * @param dest - Output buffer; should be at least `compressBound(src.length)` bytes.
   * @returns The number of compressed bytes written into `dest`.
   */
  function compress(src: Uint8Array, dest: Uint8Array): number;

  /**
   * Calculate the maximum compressed size for an input of `inputLength` bytes.
   * Use this to size the destination buffer before calling `compress()`.
   */
  function compressBound(inputLength: number): number;

  export { decompress, compress, compressBound };
}
