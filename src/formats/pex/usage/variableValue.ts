import type { PexBinaryReader } from '../utils/pexBinary';
import { OPCODE_FIXED_ARG_COUNTS } from './opcodes';

export type VariableValue = {
  type: number;
  stringIndex: number | null;
  intValue: number | null;
};

export const readVariableValue = (reader: PexBinaryReader, table: string[]): VariableValue => {
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

export const readInstruction = (
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

export const readVariableTypes = (reader: PexBinaryReader, table: string[]): void => {
  const count = reader.readU16();
  for (let i = 0; i < count; i++) {
    reader.readU16();
    reader.readU16();
  }
};
