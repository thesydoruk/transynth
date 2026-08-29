import type { PexBinaryReader } from '../pexBinary';
import { isLikelyUserText } from '../pexParser';
import { recordStringRef, resolveString, scanInstructionArgs } from './usageTracking';
import type { PexStringUsage, PexStringUsageKind } from './types';
import { readInstruction, readVariableTypes, readVariableValue } from './variableValue';

export const readFunctionBody = (
  reader: PexBinaryReader,
  table: string[],
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  ctx: Omit<PexStringUsage, 'opcode' | 'usageHint' | 'lineNumber' | 'kind'> & {
    kind: PexStringUsageKind;
    lineNumbers: number[];
  },
): void => {
  reader.readU16();
  reader.readU16();
  reader.readU32();
  reader.readU8();
  readVariableTypes(reader, table);
  readVariableTypes(reader, table);

  const instructionCount = reader.readU16();
  for (let i = 0; i < instructionCount; i++) {
    const { op, args } = readInstruction(reader, table);
    scanInstructionArgs(usagesByTableIndex, table, args, {
      objectName: ctx.objectName,
      stateName: ctx.stateName,
      functionName: ctx.functionName,
      kind: ctx.kind,
      opcode: op,
      lineNumber: ctx.lineNumbers[i] ?? null,
    });
  }
};

export const readProperty = (
  reader: PexBinaryReader,
  table: string[],
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  objectName: string,
  modernFormat: boolean,
): void => {
  const propertyName = resolveString(table, reader.readU16()) ?? '?';
  reader.readU16();
  reader.readU16();
  reader.readU32();
  const flags = reader.readU8();

  if ((flags & 0x4) !== 0) {
    reader.readU16();
    return;
  }

  if ((flags & 0x1) !== 0) {
    readFunctionBody(reader, table, usagesByTableIndex, {
      objectName,
      stateName: '',
      functionName: propertyName,
      kind: 'getter',
      lineNumbers: [],
    });
  }
  if ((flags & 0x2) !== 0) {
    readFunctionBody(reader, table, usagesByTableIndex, {
      objectName,
      stateName: '',
      functionName: propertyName,
      kind: 'setter',
      lineNumbers: [],
    });
  }
};

export const readVariable = (
  reader: PexBinaryReader,
  table: string[],
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  objectName: string,
  modernFormat: boolean,
): void => {
  const variableName = resolveString(table, reader.readU16()) ?? '?';
  reader.readU16();
  reader.readU32();
  const data = readVariableValue(reader, table);
  if (modernFormat) reader.readU8();

  if (
    data.type === 0x02 &&
    data.stringIndex != null &&
    isLikelyUserText(table[data.stringIndex] ?? '')
  ) {
    recordStringRef(usagesByTableIndex, data.stringIndex, {
      objectName,
      stateName: '',
      functionName: variableName,
      kind: 'variable-default',
      opcode: 'default',
      usageHint: 'script property',
      lineNumber: null,
    });
  }
};

export const skipObjectStructs = (
  reader: PexBinaryReader,
  table: string[],
  modernFormat: boolean,
): void => {
  if (!modernFormat) return;
  const structCount = reader.readU16();
  for (let i = 0; i < structCount; i++) {
    reader.readU16();
    const memberCount = reader.readU16();
    for (let j = 0; j < memberCount; j++) {
      reader.readU16();
      reader.readU16();
      reader.readU32();
      readVariableValue(reader, table);
      reader.readU8();
      reader.readU16();
    }
  }
};

export const skipGuards = (reader: PexBinaryReader, starfieldFormat: boolean): void => {
  if (!starfieldFormat) return;
  const count = reader.readU16();
  for (let i = 0; i < count; i++) reader.readU16();
};

export const skipSyncStates = (reader: PexBinaryReader, fo76Format: boolean): void => {
  if (!fo76Format) return;
  const count = reader.readU16();
  for (let i = 0; i < count; i++) reader.readU16();
};
