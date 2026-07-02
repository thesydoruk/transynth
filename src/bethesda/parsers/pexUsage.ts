/**
 * PEX bytecode usage analysis — maps translatable string-table entries to
 * functions and call sites (callstatic / callmethod / assign / …).
 *
 * Format reference: Open Papyrus / ImHex pex.hexpat / UESP compiled script format.
 */
import type { PexEndian } from './pexBinary';
import { PexBinaryReader, readUInt16, readWString } from './pexBinary';
import { isLikelyUserText } from './pexParser';

export type PexStringUsageKind =
  | 'function'
  | 'getter'
  | 'setter'
  | 'property-default'
  | 'variable-default';

export type PexStringUsage = {
  objectName: string;
  stateName: string;
  functionName: string;
  kind: PexStringUsageKind;
  /** Opcode name where the literal was referenced (e.g. callstatic). */
  opcode: string;
  /** Resolved call target such as `Debug.Trace` when available. */
  usageHint: string | null;
  lineNumber: number | null;
};

export type PexUserStringDetail = {
  text: string;
  tableIndex: number;
  literalIndex: number;
  usages: PexStringUsage[];
};

const OPCODE_NAMES: Record<number, string> = {
  0x00: 'nop',
  0x0d: 'assign',
  0x14: 'jmp',
  0x17: 'callmethod',
  0x18: 'callparent',
  0x19: 'callstatic',
  0x1a: 'return',
  0x1b: 'strcat',
  0x1c: 'propget',
  0x1d: 'propset',
};

const OPCODE_FIXED_ARG_COUNTS: Record<number, number> = {
  0x01: 3,
  0x02: 3,
  0x03: 3,
  0x04: 3,
  0x05: 3,
  0x06: 3,
  0x07: 3,
  0x08: 3,
  0x09: 3,
  0x0a: 2,
  0x0b: 2,
  0x0c: 2,
  0x0d: 2,
  0x0e: 2,
  0x0f: 3,
  0x10: 3,
  0x11: 3,
  0x12: 3,
  0x13: 3,
  0x14: 1,
  0x15: 2,
  0x16: 2,
  0x17: 4,
  0x18: 3,
  0x19: 4,
  0x1a: 1,
  0x1b: 3,
  0x1c: 3,
  0x1d: 3,
  0x1e: 2,
  0x1f: 2,
  0x20: 3,
  0x21: 3,
  0x22: 4,
  0x23: 4,
  0x24: 3,
  0x25: 1,
  0x26: 3,
  0x27: 3,
  0x28: 5,
  0x29: 5,
  0x2a: 3,
  0x2b: 3,
  0x2c: 1,
  0x2d: 3,
  0x2e: 1,
  0x2f: 6,
  0x30: 1,
  0x31: 1,
  0x32: 2,
};

type VariableValue = {
  type: number;
  stringIndex: number | null;
  intValue: number | null;
};

type DebugFunctionInfo = {
  objectName: string;
  stateName: string;
  functionName: string;
  lineNumbers: number[];
};

const usageKey = (usage: PexStringUsage): string =>
  [
    usage.objectName,
    usage.stateName,
    usage.functionName,
    usage.kind,
    usage.opcode,
    usage.usageHint ?? '',
    usage.lineNumber ?? '',
  ].join('\0');

const mergeUsage = (existing: PexStringUsage[], next: PexStringUsage): PexStringUsage[] => {
  const key = usageKey(next);
  if (existing.some((item) => usageKey(item) === key)) return existing;
  return [...existing, next];
};

const resolveString = (table: string[], index: number | null): string | null => {
  if (index == null || index < 0 || index >= table.length) return null;
  return table[index] ?? null;
};

const callTargetHint = (opcode: number, args: VariableValue[], table: string[]): string | null => {
  if (opcode !== 0x17 && opcode !== 0x19 && opcode !== 0x18) return null;
  const owner = resolveString(table, args[0]?.stringIndex ?? null);
  const method = resolveString(table, args[1]?.stringIndex ?? null);
  if (!owner || !method) return null;
  return `${owner}.${method}`;
};

const readVariableValue = (reader: PexBinaryReader, table: string[]): VariableValue => {
  const type = reader.readU8();
  if (type === 0x01 || type === 0x02) {
    const stringIndex = reader.readU16();
    if (stringIndex >= table.length) {
      throw new Error(`PEX: string ref ${stringIndex} out of range (${table.length})`);
    }
    return { type, stringIndex, intValue: null };
  }
  if (type === 0x03) return { type, stringIndex: null, intValue: reader.readI32() };
  if (type === 0x04) {
    reader.readF32();
    return { type, stringIndex: null, intValue: null };
  }
  if (type === 0x05) {
    reader.readU8();
    return { type, stringIndex: null, intValue: null };
  }
  if (type === 0x00) return { type, stringIndex: null, intValue: null };
  throw new Error(`PEX: unknown variable value type ${type}`);
};

const readInstruction = (
  reader: PexBinaryReader,
  table: string[],
): { op: number; args: VariableValue[] } => {
  const op = reader.readU8();
  const fixedCount = OPCODE_FIXED_ARG_COUNTS[op] ?? 0;
  const args: VariableValue[] = [];
  for (let i = 0; i < fixedCount; i++) {
    args.push(readVariableValue(reader, table));
  }

  if (op === 0x17 || op === 0x19) {
    const varArgCount = args[3]?.intValue ?? 0;
    for (let i = 0; i < varArgCount; i++) args.push(readVariableValue(reader, table));
  } else if (op === 0x18) {
    const varArgCount = args[2]?.intValue ?? 0;
    for (let i = 0; i < varArgCount; i++) args.push(readVariableValue(reader, table));
  } else if (op === 0x30 || op === 0x31) {
    const varArgCount = args[0]?.intValue ?? 0;
    for (let i = 0; i < varArgCount; i++) args.push(readVariableValue(reader, table));
  } else if (op === 0x32) {
    const varArgCount = args[1]?.intValue ?? 0;
    for (let i = 0; i < varArgCount; i++) args.push(readVariableValue(reader, table));
  }

  return { op, args };
};

const readVariableTypes = (reader: PexBinaryReader, table: string[]): void => {
  const count = reader.readU16();
  for (let i = 0; i < count; i++) {
    reader.readU16();
    reader.readU16();
  }
};

const recordStringRef = (
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  tableIndex: number,
  usage: PexStringUsage,
): void => {
  usagesByTableIndex.set(tableIndex, mergeUsage(usagesByTableIndex.get(tableIndex) ?? [], usage));
};

const scanInstructionArgs = (
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  table: string[],
  args: VariableValue[],
  ctx: Omit<PexStringUsage, 'opcode' | 'usageHint' | 'lineNumber'> & {
    opcode: number;
    lineNumber: number | null;
  },
): void => {
  const opcode = OPCODE_NAMES[ctx.opcode] ?? `op_0x${ctx.opcode.toString(16)}`;
  const usageHint = callTargetHint(ctx.opcode, args, table);
  for (const arg of args) {
    if (arg.type !== 0x02 || arg.stringIndex == null) continue;
    if (!isLikelyUserText(table[arg.stringIndex] ?? '')) continue;
    recordStringRef(usagesByTableIndex, arg.stringIndex, {
      ...ctx,
      opcode,
      usageHint,
    });
  }
};

const readFunctionBody = (
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

const readProperty = (
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

const readVariable = (
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

const skipObjectStructs = (
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

const skipGuards = (reader: PexBinaryReader, starfieldFormat: boolean): void => {
  if (!starfieldFormat) return;
  const count = reader.readU16();
  for (let i = 0; i < count; i++) reader.readU16();
};

const skipSyncStates = (reader: PexBinaryReader, fo76Format: boolean): void => {
  if (!fo76Format) return;
  const count = reader.readU16();
  for (let i = 0; i < count; i++) reader.readU16();
};

const readDebugInfo = (
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

const readObjects = (
  reader: PexBinaryReader,
  table: string[],
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  gameId: number,
  debugLines: Map<string, number[]>,
): void => {
  const modernFormat = gameId >= 2;
  const fo76Format = false; // FO76-only tail; FO4 CK may also use gameId 3
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
