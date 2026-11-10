/** A minimal compiled script: header and string table, nothing after it. */
export const buildPex = (
  strings: string[],
  opts?: { sourceFile?: string; gameId?: number; endian?: 'be' | 'le' },
): Buffer => {
  const sourceFile = opts?.sourceFile ?? 'TestScript.psc';
  const gameId = opts?.gameId ?? 3;
  const endian = opts?.endian ?? 'be';

  const wsize = (s: string) => 2 + Buffer.byteLength(s, 'utf8');
  const totalSize =
    16 +
    wsize(sourceFile) +
    wsize('testuser') +
    wsize('testmachine') +
    2 +
    strings.reduce((acc, s) => acc + wsize(s), 0);

  const buf = Buffer.alloc(totalSize, 0);
  let pos = 0;

  if (endian === 'le') buf.writeUInt32LE(0xfa57c0de, pos);
  else buf.writeUInt32BE(0xfa57c0de, pos);
  pos += 4;
  buf.writeUInt8(3, pos);
  pos += 1;
  buf.writeUInt8(2, pos);
  pos += 1;
  if (endian === 'le') buf.writeUInt16LE(gameId, pos);
  else buf.writeUInt16BE(gameId, pos);
  pos += 2;
  pos += 8;

  const writeW = (s: string) => {
    const bytes = Buffer.from(s, 'utf8');
    if (endian === 'le') buf.writeUInt16LE(bytes.length, pos);
    else buf.writeUInt16BE(bytes.length, pos);
    bytes.copy(buf, pos + 2);
    pos += 2 + bytes.length;
  };

  writeW(sourceFile);
  writeW('testuser');
  writeW('testmachine');

  if (endian === 'le') buf.writeUInt16LE(strings.length, pos);
  else buf.writeUInt16BE(strings.length, pos);
  pos += 2;
  for (const s of strings) writeW(s);

  return buf;
};
