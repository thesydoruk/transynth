import fs from 'node:fs';

const VERSION_RE = /\d+\.\d+\.\d+(?:\.\d+)?/;

/** Best-effort ProductVersion from a Windows PE executable. */
export const readPeProductVersion = (exePath: string): string | null => {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(exePath);
  } catch {
    return null;
  }
  const utf16 = buf.toString('utf16le');
  const labeled = utf16.match(/ProductVersion[\x00\s]+(\d+\.\d+\.\d+(?:\.\d+)?)/);
  if (labeled?.[1]) return labeled[1];
  const fileVer = utf16.match(/FileVersion[\x00\s]+(\d+\.\d+\.\d+(?:\.\d+)?)/);
  if (fileVer?.[1]) return fileVer[1];
  const loose = utf16.match(VERSION_RE);
  return loose?.[0] ?? null;
};
