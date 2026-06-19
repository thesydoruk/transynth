/**
 * Lightweight BA2 header peek — reads only the archive type field.
 *
 * Fallout 4 uses GNRL archives for general assets (strings, meshes, scripts)
 * and DX10 archives for textures. Callers that only need GNRL content should
 * skip non-GNRL archives instead of opening them with {@link Ba2Reader}.
 */
import fs from 'fs';
import { BA2_MAGIC, BA2_TYPE_GNRL } from './ba2Constants';

const ARCHIVE_TYPE_OFFSET = 8;
const ARCHIVE_TYPE_LENGTH = 4;

/**
 * Read the four-character archive type from a BA2 file header.
 *
 * @returns `"GNRL"`, `"DX10"`, etc., or `null` when the file is missing or
 *          not a valid BTDX archive.
 */
export function readBa2ArchiveType(filePath: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(ARCHIVE_TYPE_OFFSET + ARCHIVE_TYPE_LENGTH);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    if (bytesRead < buf.length) return null;
    if (buf.toString('ascii', 0, 4) !== BA2_MAGIC) return null;
    return buf
      .toString('ascii', ARCHIVE_TYPE_OFFSET, ARCHIVE_TYPE_OFFSET + ARCHIVE_TYPE_LENGTH)
      .replace(/\0/g, '');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Returns true when the file is a BA2 general (GNRL) archive.
 */
export function isBa2GnrArchive(filePath: string): boolean {
  return readBa2ArchiveType(filePath) === BA2_TYPE_GNRL;
}
