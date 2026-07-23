import type { PexBinaryReader } from '../utils/pexBinary';
import { resolveString } from './usageTracking';
import type { PexStringUsage } from './types';
import {
  readFunctionBody,
  readProperty,
  readVariable,
  skipGuards,
  skipObjectStructs,
  skipSyncStates,
} from './readStructures';

export const readDebugInfo = (
  reader: PexBinaryReader,
  table: string[],
  modernFormat: boolean,
): Map<string, number[]> => {
  const lineMap = new Map<string, number[]>();
  const hasDebug = reader.readU8();
  if (!hasDebug) return lineMap;

  reader.readU64();
  const functionCount = reader.readU16();
  for (let i = 0; i < functionCount; i++) {
    const objectName = resolveString(table, reader.readU16()) ?? '';
    const stateName = resolveString(table, reader.readU16()) ?? '';
    const functionName = resolveString(table, reader.readU16()) ?? '';
    reader.readU8();
    const lineCount = reader.readU16();
    const lineNumbers: number[] = [];
    for (let j = 0; j < lineCount; j++) lineNumbers.push(reader.readU16());
    lineMap.set(`${objectName}\0${stateName}\0${functionName}`, lineNumbers);
  }

  if (modernFormat) {
    const groupCount = reader.readU16();
    for (let i = 0; i < groupCount; i++) {
      reader.readU16();
      reader.readU16();
      reader.readU16();
      reader.readU32();
      const memberCount = reader.readU16();
      for (let j = 0; j < memberCount; j++) reader.readU16();
    }
    const structCount = reader.readU16();
    for (let i = 0; i < structCount; i++) {
      reader.readU16();
      reader.readU16();
      const memberCount = reader.readU16();
      for (let j = 0; j < memberCount; j++) reader.readU16();
    }
  }

  return lineMap;
};

export const readObjects = (
  reader: PexBinaryReader,
  table: string[],
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  gameId: number,
  debugLines: Map<string, number[]>,
): void => {
  const modernFormat = gameId >= 2;
  const fo76Format = false;
  const starfieldFormat = gameId >= 4;

  const objectCount = reader.readU16();
  for (let i = 0; i < objectCount; i++) {
    const objectName = resolveString(table, reader.readU16()) ?? '?';
    reader.readU32();
    reader.readU16();
    reader.readU16();
    if (modernFormat) reader.readU8();
    reader.readU32();
    reader.readU16();

    skipObjectStructs(reader, table, modernFormat);

    const variableCount = reader.readU16();
    for (let v = 0; v < variableCount; v++) {
      readVariable(reader, table, usagesByTableIndex, objectName, modernFormat);
    }

    skipGuards(reader, starfieldFormat);

    const propertyCount = reader.readU16();
    for (let p = 0; p < propertyCount; p++) {
      readProperty(reader, table, usagesByTableIndex, objectName, modernFormat);
    }

    const stateCount = reader.readU16();
    for (let s = 0; s < stateCount; s++) {
      const stateName = resolveString(table, reader.readU16()) ?? '';
      const functionCount = reader.readU16();
      for (let f = 0; f < functionCount; f++) {
        const functionName = resolveString(table, reader.readU16()) ?? '?';
        const lineNumbers = debugLines.get(`${objectName}\0${stateName}\0${functionName}`) ?? [];
        readFunctionBody(reader, table, usagesByTableIndex, {
          objectName,
          stateName,
          functionName,
          kind: 'function',
          lineNumbers,
        });
      }
    }

    skipSyncStates(reader, fo76Format);
  }
};
