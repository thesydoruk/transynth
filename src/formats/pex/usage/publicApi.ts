import type { PexEndian } from '../utils/pexBinary';
import { PexBinaryReader, readUInt16, readWString } from '../utils/pexBinary';
import { isLikelyUserText } from '../pexParser';
import { readDebugInfo, readObjects } from './readObjects';
import type { PexStringUsage, PexUserStringDetail } from './types';

/** Analyze bytecode after the string table and return per-index usage sites. */
export const analyzePexStringUsages = (
  buf: Buffer,
  offset: number,
  endian: PexEndian,
  gameId: number,
  stringTable: string[],
): Map<number, PexStringUsage[]> => {
  const usagesByTableIndex = new Map<number, PexStringUsage[]>();
  const reader = new PexBinaryReader(buf, endian, offset);

  const debugLines = readDebugInfo(reader, stringTable, gameId >= 2);

  const userFlagCount = reader.readU16();
  for (let i = 0; i < userFlagCount; i++) {
    reader.readU16();
    reader.readU8();
  }

  readObjects(reader, stringTable, usagesByTableIndex, gameId, debugLines);
  return usagesByTableIndex;
};

export const buildPexUserStringDetails = (
  stringTable: string[],
  usagesByTableIndex: Map<number, PexStringUsage[]>,
): PexUserStringDetail[] => {
  const details: PexUserStringDetail[] = [];
  let literalIndex = 0;
  for (let tableIndex = 0; tableIndex < stringTable.length; tableIndex++) {
    const text = stringTable[tableIndex] ?? '';
    if (!isLikelyUserText(text)) continue;
    literalIndex++;
    details.push({
      text,
      tableIndex,
      literalIndex,
      usages: usagesByTableIndex.get(tableIndex) ?? [],
    });
  }
  return details;
};

/** Parse string table only (shared with legacy header reader). */
export const readPexStringTable = (
  buf: Buffer,
  offset: number,
  endian: PexEndian,
): { stringTable: string[]; nextOffset: number } => {
  const count = readUInt16(buf, offset, endian);
  offset += 2;
  const stringTable: string[] = [];
  for (let i = 0; i < count; i++) {
    const { value, nextOffset } = readWString(buf, offset, endian);
    offset = nextOffset;
    stringTable.push(value);
  }
  return { stringTable, nextOffset: offset };
};
