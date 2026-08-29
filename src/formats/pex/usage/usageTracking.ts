import { isLikelyUserText } from '../pexParser';
import { OPCODE_NAMES } from './opcodes';
import type { PexStringUsage } from './types';
import type { VariableValue } from './variableValue';

export const usageKey = (usage: PexStringUsage): string =>
  [
    usage.objectName,
    usage.stateName,
    usage.functionName,
    usage.kind,
    usage.opcode,
    usage.usageHint ?? '',
    usage.lineNumber ?? '',
  ].join('\0');

export const mergeUsage = (existing: PexStringUsage[], next: PexStringUsage): PexStringUsage[] => {
  const key = usageKey(next);
  if (existing.some((item) => usageKey(item) === key)) return existing;
  return [...existing, next];
};

export const resolveString = (table: string[], index: number | null): string | null => {
  if (index == null || index < 0 || index >= table.length) return null;
  return table[index] ?? null;
};

export const callTargetHint = (
  opcode: number,
  args: VariableValue[],
  table: string[],
): string | null => {
  if (opcode !== 0x17 && opcode !== 0x19 && opcode !== 0x18) return null;
  const owner = resolveString(table, args[0]?.stringIndex ?? null);
  const method = resolveString(table, args[1]?.stringIndex ?? null);
  if (!owner || !method) return null;
  return `${owner}.${method}`;
};

export const recordStringRef = (
  usagesByTableIndex: Map<number, PexStringUsage[]>,
  tableIndex: number,
  usage: PexStringUsage,
): void => {
  usagesByTableIndex.set(tableIndex, mergeUsage(usagesByTableIndex.get(tableIndex) ?? [], usage));
};

export const scanInstructionArgs = (
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
